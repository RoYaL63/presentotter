import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  session,
  shell,
  type Display,
  type WebContents
} from 'electron'
import { promises as fsp, accessSync, constants as fsConstants } from 'node:fs'
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
/** True while the spotlight tool is selected. Drives the same cursor
 *  poll as `cursorHighlightOn` so the overlay can draw a dark wash
 *  with a clear circle that follows the mouse, no drag required. */
let spotlightActive = false

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

  win.once('ready-to-show', () => {
    win.showInactive()
    // After the overlay raises, push the toolbar back above it so its
    // buttons stay clickable (see setOverlaysInteractive comment).
    if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
      toolbarWindow.moveTop()
    }
  })
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
  // Window dimensions need slack on both axes so the inner capsule
  // shape can draw its rounded ends without being clipped by the
  // rectangular BrowserWindow frame. ~60 px of horizontal margin gives
  // each side enough room for the 40 px radius.
  const TOOLBAR_W = 1120
  const TOOLBAR_H = 108

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

/**
 * Re-create the Home window if it has been closed, otherwise un-minimize
 * + raise + focus it. Used by every "go back to the app" intent (Toolbar
 * logo click, manual-sanitizer shortcut, Console layout button, …).
 */
function bringHomeToFront(): void {
  if (homeWindow === null || homeWindow.isDestroyed()) {
    homeWindow = createHomeWindow()
    return
  }
  if (homeWindow.isMinimized()) homeWindow.restore()
  homeWindow.show()
  homeWindow.focus()
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
  // On Windows, `alwaysOnTop: 'screen-saver'` on both the toolbar AND
  // the overlay puts them in the same z-tier; the OS then orders them
  // by last activity. An overlay that just received `setFocusable(true)`
  // can briefly climb above the toolbar, hiding its buttons under the
  // draw surface. Pushing the toolbar back to the top after every
  // interactivity flip keeps its clicks reachable.
  if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
    toolbarWindow.moveTop()
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

/** Single source of truth for "should the cursor poll be running?". The
 *  poll fires while either the cursor highlight OR the spotlight tool
 *  is active — they both consume the same cursor position stream. */
function syncCursorTracking(): void {
  if (cursorHighlightOn || spotlightActive) startCursorTracking()
  else stopCursorTracking()
}

// ============================================================================
// IPC
// ============================================================================

function registerIpcHandlers(): void {
  ipcMain.handle('window:get-role', (event) => getWindowRole(event.sender))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('toolbar:is-enabled', () => toolbarWindow !== null && !toolbarWindow.isDestroyed())

  /** Recording — enumerate capturable sources for the source picker.
   *  Returns small base64 thumbnails so the renderer can show a live
   *  preview of each option (screen, window). Tab capture is offered as
   *  a separate path in the renderer because Electron only exposes it
   *  through the in-page getDisplayMedia picker. */
  ipcMain.handle('recording:list-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      appIcon: s.appIcon?.isEmpty() === false ? s.appIcon.toDataURL() : null
    }))
  })

  /** Recording — write a captured blob (as a Uint8Array forwarded over
   *  IPC) to the user's Videos\PresentOtter folder and reveal it in
   *  Explorer. The renderer cannot fs.writeFile directly; this is the
   *  trust boundary where we hand the bytes off to the file system. */
  ipcMain.handle(
    'recording:save-blob',
    async (_e, payload: { bytes: Uint8Array; suggestedName: string }) => {
      const videosRoot = app.getPath('videos')
      const dir = path.join(videosRoot, 'PresentOtter')
      await fsp.mkdir(dir, { recursive: true })
      const safeName = sanitizeFileName(payload.suggestedName)
      const full = path.join(dir, safeName)
      await fsp.writeFile(full, Buffer.from(payload.bytes))
      return { path: full, dir }
    }
  )

  /** Open a saved recording's containing folder in Explorer. */
  ipcMain.handle('recording:reveal-in-folder', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  /** Convert a saved WebM to MP4 via the system ffmpeg. We deliberately
   *  do NOT bundle ffmpeg (~80 MB) — users who want MP4 install once via
   *  `winget install Gyan.FFmpeg` or `choco install ffmpeg`. Returns the
   *  output path on success, or a discriminator the UI can use to show
   *  the right hint. */
  ipcMain.handle('recording:export-mp4', async (_e, webmPath: string) => {
    const ffmpeg = locateFfmpeg()
    if (ffmpeg === null) {
      return { ok: false as const, reason: 'ffmpeg-missing' as const }
    }
    if (!webmPath.toLowerCase().endsWith('.webm')) {
      return { ok: false as const, reason: 'not-a-webm' as const }
    }
    const mp4Path = webmPath.replace(/\.webm$/i, '.mp4')
    const { spawn } = await import('node:child_process')
    return await new Promise<{ ok: true; path: string } | { ok: false; reason: string }>(
      (resolve) => {
        const proc = spawn(
          ffmpeg,
          [
            '-y',
            '-i', webmPath,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '22',
            '-c:a', 'aac',
            '-b:a', '160k',
            '-movflags', '+faststart',
            mp4Path
          ],
          { windowsHide: true }
        )
        proc.on('error', (err) =>
          resolve({ ok: false, reason: `ffmpeg-error: ${err.message}` })
        )
        proc.on('exit', (code) => {
          if (code === 0) resolve({ ok: true, path: mp4Path })
          else resolve({ ok: false, reason: `ffmpeg-exit-${code ?? 'null'}` })
        })
      }
    )
  })

  /** Let the user pick a different output location for a one-off save. */
  ipcMain.handle('recording:choose-save-path', async (_e, defaultName: string) => {
    if (homeWindow === null || homeWindow.isDestroyed()) return null
    const res = await dialog.showSaveDialog(homeWindow, {
      title: 'Enregistrer la capture',
      defaultPath: path.join(app.getPath('videos'), 'PresentOtter', defaultName),
      filters: [
        { name: 'Vidéo WebM', extensions: ['webm'] },
        { name: 'Tous fichiers', extensions: ['*'] }
      ]
    })
    return res.canceled ? null : res.filePath ?? null
  })

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
    toolbarWindow.setSize(1120, 108, true)
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
  ipcMain.on('overlay:set-live-ocr-words', (_e, words: unknown) => {
    forwardToOverlays('overlay:set-live-ocr-words', words)
  })
  ipcMain.on('overlay:clear-live-ocr-words', () => {
    forwardToOverlays('overlay:clear-live-ocr-words')
  })

  ipcMain.on('cursor:set-highlight', (_e, enabled: boolean) => {
    cursorHighlightOn = enabled
    forwardToOverlays('cursor:set-highlight', enabled)
    if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
      toolbarWindow.webContents.send('toolbar:cursor-highlight-changed', enabled)
    }
    syncCursorTracking()
  })

  ipcMain.on('spotlight:set-active', (_e, active: boolean) => {
    spotlightActive = active
    forwardToOverlays('spotlight:set-active', active)
    syncCursorTracking()
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
    bringHomeToFront()
  })

  /** Toolbar shortcut to the manual sanitizer popup. The popup has to
   *  live inside the Home window because the Toolbar window is only
   *  100 px tall — too short to fit the modal's textarea + verdict.
   *  So we focus Home then tell it to open the popup. */
  ipcMain.on('console:open-sanitizer', () => {
    bringHomeToFront()
    if (homeWindow !== null && !homeWindow.isDestroyed()) {
      homeWindow.webContents.send('home:open-sanitizer')
    }
  })

  /** Same plumbing for the keyboard-shortcuts cheat sheet — too tall
   *  for the toolbar window, lives in Home. */
  ipcMain.on('console:open-shortcuts', () => {
    bringHomeToFront()
    if (homeWindow !== null && !homeWindow.isDestroyed()) {
      homeWindow.webContents.send('home:open-shortcuts')
    }
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
  syncCursorTracking()
}

/**
 * Strip path separators and reserved Windows filename characters so the
 * renderer-supplied name cannot escape the PresentOtter folder.
 */
/**
 * Look up ffmpeg.exe on the system PATH so we can re-encode WebM → MP4
 * on demand. Returns null if not installed; the UI then surfaces a hint
 * to install via winget/choco rather than silently failing.
 */
function locateFfmpeg(): string | null {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter)
  const candidates = ['ffmpeg.exe', 'ffmpeg']
  for (const dir of pathDirs) {
    if (dir.length === 0) continue
    for (const c of candidates) {
      const full = path.join(dir, c)
      try {
        // existsSync would be sufficient on Windows; using accessSync
        // also catches permission anomalies.
        accessSync(full, fsConstants.X_OK)
        return full
      } catch {
        /* not here, keep looking */
      }
    }
  }
  return null
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim()
  const cleaned = trimmed.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 200)
  return cleaned.length > 0 ? cleaned : `recording-${Date.now()}.webm`
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
