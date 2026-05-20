import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  session,
  type Display,
  type WebContents
} from 'electron'
import path from 'path'
import { startTripleAltDetector, stopTripleAltDetector } from './triple-alt-detector'

/**
 * PresentOtter main process.
 *
 * Window model:
 *
 * 1. **Home** — primary, framed, classic app window. Always shown at startup.
 *    Hosts a landing page where the user toggles the floating toolbar on/off,
 *    accesses settings, library, manual sanitizer, etc. Closing the Home
 *    window quits the app. Minimizing it keeps everything else (toolbar +
 *    overlays) alive in the background.
 *
 * 2. **Toolbar** — small, frameless, transparent, always-on-top. Created on
 *    demand from the Home page (or via IPC). Hosts the annotation tools and
 *    triggers the overlays. Closing it with the ✕ destroys it AND the
 *    overlays, but the Home stays — the user can re-enable from there.
 *
 * 3. **Overlays** — one per Display, fullscreen, transparent, click-through.
 *    Created together with the toolbar; destroyed when the toolbar closes.
 *
 * 4. **Console** — secondary window for Library / Preview / Settings. Opened
 *    on demand from anywhere. Multiple are tolerated but only one at a time
 *    is typical.
 */

let homeWindow: BrowserWindow | null = null
let toolbarWindow: BrowserWindow | null = null
const overlayWindows = new Map<number, BrowserWindow>() // keyed by Display.id
let cursorInterval: ReturnType<typeof setInterval> | null = null
let cursorHighlightOn = false

const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:5173'
const CURSOR_POLL_MS = 16

function rendererUrl(hash: 'home' | 'toolbar' | 'overlay'): string {
  if (isDev) {
    return `${DEV_URL}/#${hash}`
  }
  const filePath = path.join(__dirname, '..', 'renderer', 'index.html')
  return `file://${filePath}#${hash}`
}

function getWindowRole(wc: WebContents): 'home' | 'toolbar' | 'overlay' {
  if (homeWindow && wc.id === homeWindow.webContents.id) return 'home'
  if (toolbarWindow && wc.id === toolbarWindow.webContents.id) return 'toolbar'
  for (const w of overlayWindows.values()) {
    if (w.webContents.id === wc.id) return 'overlay'
  }
  return 'home'
}

// ============================================================================
// Home window — primary entry
// ============================================================================

function createHomeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 840,
    minHeight: 560,
    // Glacier — the otter-morphism light base. Avoids the harsh black
    // splash between window-create and renderer-paint.
    backgroundColor: '#E8F4F8',
    title: 'PresentOtter',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  void win.loadURL(rendererUrl('home'))

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    homeWindow = null
    // Closing Home tears everything down.
    closeToolbarAndOverlays()
  })

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  return win
}

// ============================================================================
// Toolbar + Overlays — lazy
// ============================================================================

function createOverlayWindow(display: Display): BrowserWindow {
  const { x, y, width, height } = display.bounds

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  void win.loadURL(rendererUrl('overlay'))

  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => {
    overlayWindows.delete(display.id)
  })

  return win
}

function spawnOverlayForAllDisplays(): void {
  for (const display of screen.getAllDisplays()) {
    if (!overlayWindows.has(display.id)) {
      overlayWindows.set(display.id, createOverlayWindow(display))
    }
  }
}

function createToolbarWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, width } = primary.workArea
  const TOOLBAR_W = 1040
  const TOOLBAR_H = 100

  const win = new BrowserWindow({
    x: x + Math.floor((width - TOOLBAR_W) / 2),
    y: 24,
    width: TOOLBAR_W,
    height: TOOLBAR_H,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  void win.loadURL(rendererUrl('toolbar'))

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    toolbarWindow = null
    // Closing the toolbar tears down overlays + cursor poll, but NOT the Home.
    for (const w of overlayWindows.values()) {
      if (!w.isDestroyed()) w.close()
    }
    overlayWindows.clear()
    stopCursorTracking()
    notifyHomeStatus()
  })

  return win
}

function enableToolbar(): void {
  if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
    toolbarWindow.show()
    toolbarWindow.focus()
    notifyHomeStatus()
    return
  }
  spawnOverlayForAllDisplays()
  toolbarWindow = createToolbarWindow()
  notifyHomeStatus()
}

function disableToolbar(): void {
  closeToolbarAndOverlays()
  notifyHomeStatus()
}

function closeToolbarAndOverlays(): void {
  if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
    toolbarWindow.close()
  }
  for (const w of overlayWindows.values()) {
    if (!w.isDestroyed()) w.close()
  }
  overlayWindows.clear()
  stopCursorTracking()
}

function notifyHomeStatus(): void {
  if (homeWindow === null || homeWindow.isDestroyed()) return
  homeWindow.webContents.send('home:toolbar-status', {
    enabled: toolbarWindow !== null && !toolbarWindow.isDestroyed()
  })
}

// ============================================================================
// Fan-out helpers — IPC reaches every alive overlay
// ============================================================================

function forwardToOverlays<T>(channel: string, payload?: T): void {
  for (const w of overlayWindows.values()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function setOverlaysInteractive(interactive: boolean): void {
  for (const w of overlayWindows.values()) {
    if (w.isDestroyed()) continue
    if (interactive) {
      w.setIgnoreMouseEvents(false)
      w.setFocusable(true)
    } else {
      w.setIgnoreMouseEvents(true, { forward: true })
      w.setFocusable(false)
    }
  }
}

function setOverlaysVisible(visible: boolean): void {
  for (const w of overlayWindows.values()) {
    if (w.isDestroyed()) continue
    if (visible) w.showInactive()
    else w.hide()
  }
}

// ============================================================================
// Cursor highlight
// ============================================================================

function startCursorTracking(): void {
  if (cursorInterval !== null) return
  cursorInterval = setInterval(() => {
    if (overlayWindows.size === 0) return
    const pt = screen.getCursorScreenPoint()
    const onDisplay = screen.getDisplayNearestPoint(pt)
    forwardToOverlays('cursor:position', {
      screenX: pt.x,
      screenY: pt.y,
      onDisplayId: onDisplay.id,
      displayBounds: onDisplay.bounds,
      timestamp: Date.now()
    })
  }, CURSOR_POLL_MS)
}

function stopCursorTracking(): void {
  if (cursorInterval !== null) {
    clearInterval(cursorInterval)
    cursorInterval = null
  }
}

// ============================================================================
// IPC
// ============================================================================

function registerIpcHandlers(): void {
  ipcMain.handle('window:get-role', (event) => getWindowRole(event.sender))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('toolbar:is-enabled', () => toolbarWindow !== null && !toolbarWindow.isDestroyed())

  /** Live sanitizer asks main: which display should I capture, and what is
   *  its position + DPI so I can translate OCR pixel coordinates into the
   *  virtual-screen CSS coordinates the overlays use? We pick the display
   *  the cursor is currently on so the user can choose by simply moving
   *  the mouse to the screen they want scanned. */
  ipcMain.handle('live:acquire-target', async () => {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    })
    // Electron's source.display_id is a string (e.g. "12345"); Display.id is
    // a number. Match by string equality after coercion.
    const wanted = String(display.id)
    let match = sources.find(
      (s: Electron.DesktopCapturerSource & { display_id?: string }) =>
        s.display_id === wanted
    )
    if (match === undefined) match = sources[0]
    if (match === undefined) {
      return null
    }
    return {
      sourceId: match.id,
      displayId: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    }
  })

  // Home → main: toggle toolbar
  ipcMain.on('toolbar:enable', () => enableToolbar())
  ipcMain.on('toolbar:disable', () => disableToolbar())

  // Toolbar → main: close (just the toolbar, not the app)
  ipcMain.on('toolbar:close', () => disableToolbar())
  ipcMain.on('toolbar:minimize', () => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    toolbarWindow.setSize(72, 72, true)
  })
  ipcMain.on('toolbar:restore', () => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    toolbarWindow.setSize(1040, 100, true)
  })

  // Toolbar → Overlay(s)
  ipcMain.on('overlay:set-tool', (_e, tool: string) =>
    forwardToOverlays('overlay:set-tool', tool)
  )
  ipcMain.on('overlay:set-color', (_e, hex: string) =>
    forwardToOverlays('overlay:set-color', hex)
  )
  ipcMain.on('overlay:set-opacity', (_e, value: number) =>
    forwardToOverlays('overlay:set-opacity', value)
  )
  ipcMain.on('overlay:set-stroke', (_e, width: number) =>
    forwardToOverlays('overlay:set-stroke', width)
  )
  ipcMain.on('overlay:clear', () => forwardToOverlays('overlay:clear'))
  ipcMain.on('overlay:undo', () => forwardToOverlays('overlay:undo'))

  ipcMain.on('overlay:set-interactive', (_e, interactive: boolean) =>
    setOverlaysInteractive(interactive)
  )

  /** Overlay-initiated focus request — used by the text tool, which needs
   *  the window to hold keyboard focus before its <input autoFocus> can
   *  receive typing. Without this the input mounts in a focusable but
   *  unfocused window and keypresses go nowhere. */
  ipcMain.on('overlay:request-focus', (event) => {
    for (const w of overlayWindows.values()) {
      if (w.isDestroyed()) continue
      if (w.webContents.id === event.sender.id) {
        w.setFocusable(true)
        w.focus()
        w.webContents.focus()
        break
      }
    }
  })
  ipcMain.on('overlay:set-visible', (_e, visible: boolean) =>
    setOverlaysVisible(visible)
  )

  ipcMain.on('overlay:set-live-masks', (_e, zones: unknown) => {
    forwardToOverlays('overlay:set-live-masks', zones)
  })
  ipcMain.on('overlay:clear-live-masks', () => {
    forwardToOverlays('overlay:clear-live-masks')
  })

  ipcMain.on('cursor:set-highlight', (_e, enabled: boolean) => {
    cursorHighlightOn = enabled
    forwardToOverlays('cursor:set-highlight', enabled)
    if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
      toolbarWindow.webContents.send('toolbar:cursor-highlight-changed', enabled)
    }
    if (enabled) startCursorTracking()
    else stopCursorTracking()
  })
  ipcMain.on('cursor:set-color', (_e, hex: string) => {
    forwardToOverlays('cursor:set-color', hex)
  })
  ipcMain.on('cursor:set-settings', (_e, settings: unknown) => {
    forwardToOverlays('cursor:set-settings', settings)
  })

  // Console launcher → bring the Home window to front instead of opening a
  // secondary BrowserWindow. The Tools/Library/Settings pages are now
  // sections inside Home; the IPC channel is kept so the Toolbar's Layout
  // button still has somewhere to send its 'open the console' intent.
  ipcMain.on('console:open', () => {
    if (homeWindow === null || homeWindow.isDestroyed()) {
      homeWindow = createHomeWindow()
      return
    }
    if (homeWindow.isMinimized()) homeWindow.restore()
    homeWindow.show()
    homeWindow.focus()
  })
}

// ============================================================================
// Global shortcuts (only meaningful when toolbar is up)
// ============================================================================

function selectToolFromShortcut(tool: string): void {
  if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
  forwardToOverlays('overlay:set-tool', tool)
  setOverlaysInteractive(tool !== 'select')
  toolbarWindow.webContents.send('toolbar:tool-changed', tool)
}

function registerGlobalShortcuts(): void {
  const bindings: Array<{ accel: string; fn: () => void }> = [
    { accel: 'Alt+S', fn: () => selectToolFromShortcut('select') },
    { accel: 'Alt+P', fn: () => selectToolFromShortcut('pencil') },
    { accel: 'Alt+R', fn: () => selectToolFromShortcut('rectangle') },
    { accel: 'Alt+O', fn: () => selectToolFromShortcut('circle') },
    { accel: 'Alt+A', fn: () => selectToolFromShortcut('arrow') },
    { accel: 'Alt+T', fn: () => selectToolFromShortcut('text') },
    { accel: 'Alt+L', fn: () => selectToolFromShortcut('spotlight') },
    { accel: 'Alt+Z', fn: () => forwardToOverlays('overlay:undo') },
    { accel: 'Alt+Shift+C', fn: () => forwardToOverlays('overlay:clear') },
    {
      accel: 'Alt+H',
      fn: () => {
        const anyVisible = [...overlayWindows.values()].some(
          (w) => !w.isDestroyed() && w.isVisible()
        )
        setOverlaysVisible(!anyVisible)
      }
    },
    {
      accel: 'Alt+B',
      fn: () => {
        if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
        if (toolbarWindow.isVisible()) toolbarWindow.hide()
        else toolbarWindow.show()
      }
    },
    { accel: 'Escape', fn: () => selectToolFromShortcut('select') }
  ]

  for (const { accel, fn } of bindings) {
    globalShortcut.register(accel, fn)
  }
}

/**
 * Triple-tap Alt shortcut → toggle cursor highlight.
 *
 * If the floating toolbar is not yet enabled when the user taps, we spin it
 * up first so the overlays exist to render the cursor halo on. That makes
 * the shortcut a true one-gesture "summon highlighted cursor" trigger.
 */
function handleTripleAlt(): void {
  if (toolbarWindow === null || toolbarWindow.isDestroyed()) {
    enableToolbar()
  }
  cursorHighlightOn = !cursorHighlightOn
  forwardToOverlays('cursor:set-highlight', cursorHighlightOn)
  if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
    toolbarWindow.webContents.send('toolbar:cursor-highlight-changed', cursorHighlightOn)
  }
  if (cursorHighlightOn) startCursorTracking()
  else stopCursorTracking()
}

function configureDisplayMedia(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const primary = sources[0]
        if (primary) callback({ video: primary })
        else callback({})
      })
      .catch((err: unknown) => {
        console.error('[main] desktopCapturer.getSources failed:', err)
        callback({})
      })
  })
}

function setupDisplayHotPlug(): void {
  screen.on('display-added', (_e, display) => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    if (!overlayWindows.has(display.id)) {
      overlayWindows.set(display.id, createOverlayWindow(display))
    }
  })
  screen.on('display-removed', (_e, display) => {
    const w = overlayWindows.get(display.id)
    if (w !== undefined && !w.isDestroyed()) w.close()
    overlayWindows.delete(display.id)
  })
  screen.on('display-metrics-changed', (_e, display) => {
    const w = overlayWindows.get(display.id)
    if (w !== undefined && !w.isDestroyed()) {
      const { x, y, width, height } = display.bounds
      w.setBounds({ x, y, width, height })
    }
  })
}

// ============================================================================
// Lifecycle
// ============================================================================

app
  .whenReady()
  .then(() => {
    configureDisplayMedia()
    registerIpcHandlers()
    homeWindow = createHomeWindow()
    registerGlobalShortcuts()
    setupDisplayHotPlug()
    startTripleAltDetector(handleTripleAlt)
  })
  .catch((err: unknown) => {
    console.error('[main] startup failed:', err)
  })

app.on('will-quit', () => {
  stopCursorTracking()
  stopTripleAltDetector()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (homeWindow === null) {
    homeWindow = createHomeWindow()
  }
})
