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

/**
 * PresentOtter main process — multi-monitor edition.
 *
 * Windows spawned at startup:
 *
 * 1. **Toolbar** (1 instance) — small, frameless, transparent, always-on-top.
 *    Hosts annotation tools, color swatches, live sanitizer toggle, cursor
 *    highlight toggle, console launcher, minimize and quit.
 *
 * 2. **Overlays** (1 per Display) — fullscreen, frameless, transparent,
 *    always-on-top, click-through by default. The toolbar issues IPC commands;
 *    the main process forwards them to *every* overlay so annotations follow
 *    the cursor across screens. New monitors plugged in at runtime spawn
 *    a fresh overlay; unplugged ones are torn down.
 *
 * 3. **Console** (on demand) — the multi-page UI (Home/Library/Settings...)
 *    opened by the Layout button in the toolbar.
 */

let toolbarWindow: BrowserWindow | null = null
const overlayWindows = new Map<number, BrowserWindow>() // keyed by Display.id
let cursorInterval: ReturnType<typeof setInterval> | null = null

const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:5173'
const CURSOR_POLL_MS = 16 // ~60 Hz

function rendererUrl(hash: 'toolbar' | 'overlay' | 'console'): string {
  if (isDev) {
    return `${DEV_URL}/#${hash}`
  }
  const filePath = path.join(__dirname, '..', 'renderer', 'index.html')
  return `file://${filePath}#${hash}`
}

function getWindowRole(wc: WebContents): 'toolbar' | 'overlay' | 'console' {
  if (toolbarWindow && wc.id === toolbarWindow.webContents.id) return 'toolbar'
  for (const w of overlayWindows.values()) {
    if (w.webContents.id === wc.id) return 'overlay'
  }
  return 'console'
}

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

  // Float above almost everything (above screen-saver level on Windows).
  win.setAlwaysOnTop(true, 'screen-saver')
  // Click-through by default; the toolbar will flip this when a tool is picked.
  win.setIgnoreMouseEvents(true, { forward: true })
  // Visible across virtual desktops / Spaces (no-op on Windows, useful on macOS).
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
  const TOOLBAR_W = 760
  const TOOLBAR_H = 96

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
    skipTaskbar: false,
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
    for (const w of overlayWindows.values()) {
      if (!w.isDestroyed()) w.close()
    }
    overlayWindows.clear()
  })

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  return win
}

/** Send an event to every alive overlay window. */
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

/**
 * Start a 60 Hz poll of the OS cursor position and broadcast it to every
 * overlay. Each overlay decides whether the cursor is on its display (via
 * its own bounds, sent in payload). The renderer paints a halo + trail
 * when cursor highlight is enabled by the user.
 */
function startCursorTracking(): void {
  if (cursorInterval !== null) return
  cursorInterval = setInterval(() => {
    if (overlayWindows.size === 0) return
    const pt = screen.getCursorScreenPoint()
    // Identify which display the cursor is on so the overlay can map
    // global screen coordinates to its own local frame.
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

function registerIpcHandlers(): void {
  ipcMain.handle('window:get-role', (event) => getWindowRole(event.sender))
  ipcMain.handle('app:version', () => app.getVersion())

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
  ipcMain.on('overlay:set-visible', (_e, visible: boolean) =>
    setOverlaysVisible(visible)
  )

  ipcMain.on('toolbar:minimize', () => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    toolbarWindow.setSize(72, 72, true)
  })
  ipcMain.on('toolbar:restore', () => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    toolbarWindow.setSize(760, 96, true)
  })
  ipcMain.on('toolbar:close', () => {
    if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
      toolbarWindow.close()
    }
  })

  // Live sanitizer masks (toolbar runs OCR, overlays render the rectangles)
  ipcMain.on('overlay:set-live-masks', (_e, zones: unknown) => {
    forwardToOverlays('overlay:set-live-masks', zones)
  })
  ipcMain.on('overlay:clear-live-masks', () => {
    forwardToOverlays('overlay:clear-live-masks')
  })

  // Cursor highlight on/off
  ipcMain.on('cursor:set-highlight', (_e, enabled: boolean) => {
    forwardToOverlays('cursor:set-highlight', enabled)
    if (enabled) startCursorTracking()
    else stopCursorTracking()
  })

  // Console launcher
  ipcMain.on('console:open', () => {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 1024,
      minHeight: 700,
      backgroundColor: '#050a14',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    void win.loadURL(rendererUrl('console'))
    win.once('ready-to-show', () => win.show())
  })
}

function selectToolFromShortcut(tool: string): void {
  forwardToOverlays('overlay:set-tool', tool)
  setOverlaysInteractive(tool !== 'select')
  if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
    toolbarWindow.webContents.send('toolbar:tool-changed', tool)
  }
}

function registerGlobalShortcuts(): void {
  const bindings: Array<{ accel: string; fn: () => void; label: string }> = [
    { accel: 'Alt+S', fn: () => selectToolFromShortcut('select'), label: 'Select' },
    { accel: 'Alt+P', fn: () => selectToolFromShortcut('pencil'), label: 'Pencil' },
    { accel: 'Alt+R', fn: () => selectToolFromShortcut('rectangle'), label: 'Rectangle' },
    { accel: 'Alt+O', fn: () => selectToolFromShortcut('circle'), label: 'Circle (oval)' },
    { accel: 'Alt+A', fn: () => selectToolFromShortcut('arrow'), label: 'Arrow' },
    { accel: 'Alt+T', fn: () => selectToolFromShortcut('text'), label: 'Text' },
    { accel: 'Alt+L', fn: () => selectToolFromShortcut('spotlight'), label: 'Spotlight' },
    { accel: 'Alt+Z', fn: () => forwardToOverlays('overlay:undo'), label: 'Undo' },
    { accel: 'Alt+Shift+C', fn: () => forwardToOverlays('overlay:clear'), label: 'Clear all' },
    {
      accel: 'Alt+H',
      fn: () => {
        const anyVisible = [...overlayWindows.values()].some(
          (w) => !w.isDestroyed() && w.isVisible()
        )
        setOverlaysVisible(!anyVisible)
      },
      label: 'Hide / show overlay'
    },
    {
      accel: 'Alt+B',
      fn: () => {
        if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
        if (toolbarWindow.isVisible()) toolbarWindow.hide()
        else toolbarWindow.show()
      },
      label: 'Hide / show toolbar'
    },
    {
      accel: 'Escape',
      fn: () => selectToolFromShortcut('select'),
      label: 'Exit drawing (back to select)'
    }
  ]

  for (const { accel, fn, label } of bindings) {
    const ok = globalShortcut.register(accel, fn)
    if (!ok) {
      console.warn(`[shortcuts] Failed to register ${accel} (${label})`)
    }
  }
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
  // New monitor plugged in → spawn an overlay for it.
  screen.on('display-added', (_e, display) => {
    if (!overlayWindows.has(display.id)) {
      overlayWindows.set(display.id, createOverlayWindow(display))
    }
  })
  // Monitor unplugged → close its overlay.
  screen.on('display-removed', (_e, display) => {
    const w = overlayWindows.get(display.id)
    if (w !== undefined && !w.isDestroyed()) {
      w.close()
    }
    overlayWindows.delete(display.id)
  })
  // Resolution / position changed → reposition the existing overlay.
  screen.on('display-metrics-changed', (_e, display) => {
    const w = overlayWindows.get(display.id)
    if (w !== undefined && !w.isDestroyed()) {
      const { x, y, width, height } = display.bounds
      w.setBounds({ x, y, width, height })
    }
  })
}

app
  .whenReady()
  .then(() => {
    configureDisplayMedia()
    registerIpcHandlers()
    spawnOverlayForAllDisplays()
    toolbarWindow = createToolbarWindow()
    registerGlobalShortcuts()
    setupDisplayHotPlug()
  })
  .catch((err: unknown) => {
    console.error('[main] startup failed:', err)
  })

app.on('will-quit', () => {
  stopCursorTracking()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    spawnOverlayForAllDisplays()
    toolbarWindow = createToolbarWindow()
  }
})
