import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  type Display,
  type WebContents
} from 'electron'
import { promises as fsp, accessSync, constants as fsConstants } from 'node:fs'
import path from 'path'
import {
  startTripleAltDetector,
  stopTripleAltDetector,
  setEscapeHandler
} from './triple-alt-detector'
import {
  checkForUpdate,
  downloadAndLaunch,
  revealInExplorer,
  type UpdateCheck
} from './updater'
import {
  registerCaptureIpc,
  startCapture,
  type OwnUiState
} from './capture'

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

function rendererUrl(
  hash: 'home' | 'toolbar' | 'overlay' | 'capture' | 'editor'
): string {
  if (isDev) {
    return `${DEV_URL}/#${hash}`
  }
  const filePath = path.join(__dirname, '..', 'renderer', 'index.html')
  return `file://${filePath}#${hash}`
}

/**
 * Clamp a (x, y, w, h) rectangle so the resulting window stays within
 * the union of every display's workArea, keeping at least MARGIN px on
 * each axis visible. Used by every toolbar resize/move path so a
 * mid-screen drag, a minimize→restore round-trip, or an orientation
 * flip can never park the window off-screen.
 */
function clampToolbarPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of screen.getAllDisplays()) {
    const a = d.workArea
    if (a.x < minX) minX = a.x
    if (a.y < minY) minY = a.y
    if (a.x + a.width > maxX) maxX = a.x + a.width
    if (a.y + a.height > maxY) maxY = a.y + a.height
  }
  if (!Number.isFinite(minX)) return { x, y } // no displays — bail
  const MARGIN = 24
  const cx = Math.max(minX - width + MARGIN, Math.min(maxX - MARGIN, x))
  const cy = Math.max(minY - height + MARGIN, Math.min(maxY - MARGIN, y))
  return { x: cx, y: cy }
}

function getWindowRole(
  wc: WebContents
): 'home' | 'toolbar' | 'overlay' {
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
    // Born focusable so the text-tool inline input can receive keystrokes
    // when we ask main to focus the window. Windows doesn't reliably apply
    // a later setFocusable(true) after the window is already shown.
    // Click-through is controlled by setIgnoreMouseEvents alone.
    focusable: true,
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
    // Make sure THIS overlay knows where the toolbar is so its
    // no-draw zone is correct on first render.
    broadcastToolbarBounds()
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

/**
 * Push the current toolbar bounds (screen coordinates) to every
 * overlay. Overlays use this to ignore pointer-down events whose
 * position falls inside the toolbar's rectangle — otherwise a stroke
 * started while the cursor is over the toolbar would render UNDER the
 * toolbar window, which looks like the pencil "writes through the bar".
 */
function broadcastToolbarBounds(): void {
  if (toolbarWindow === null || toolbarWindow.isDestroyed()) {
    forwardToOverlays('overlay:set-toolbar-rect', null)
    return
  }
  const b = toolbarWindow.getBounds()
  forwardToOverlays('overlay:set-toolbar-rect', {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height
  })
}

function createToolbarWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, width } = primary.workArea
  // Window dimensions: ~80 px of horizontal slack and ~24 px vertical
  // so the inner 36 px radius corners always render fully inside the
  // BrowserWindow frame. Earlier sizes (1040×100, 1120×108) had the
  // content edge brushing the window edge on hi-DPI screens, which
  // chopped the curve at the corner.
  const TOOLBAR_W = 1180
  const TOOLBAR_H = 112

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

  // relativeLevel 1 puts the toolbar ONE layer above the overlay (which
  // also sits at 'screen-saver'). On Windows two windows at the same
  // always-on-top level get reordered by activity, so the interactive
  // overlay could climb over the toolbar and steal clicks (the user
  // would draw instead of clicking an icon). The higher relative level
  // keeps the toolbar reliably clickable on top of the draw surface.
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  void win.loadURL(rendererUrl('toolbar'))

  win.once('ready-to-show', () => {
    win.show()
    broadcastToolbarBounds()
  })
  // Toolbar can be moved (drag region) or resized (minimize → restore).
  // Each change needs to ripple to the overlays so their no-draw zone
  // tracks the actual on-screen rectangle.
  win.on('move', () => broadcastToolbarBounds())
  win.on('resize', () => broadcastToolbarBounds())
  win.on('show', () => broadcastToolbarBounds())
  win.on('hide', () => forwardToOverlays('overlay:set-toolbar-rect', null))
  win.on('closed', () => {
    toolbarWindow = null
    // Closing the toolbar tears down overlays + cursor poll, but NOT the Home.
    for (const w of overlayWindows.values()) {
      if (!w.isDestroyed()) w.close()
    }
    overlayWindows.clear()
    stopCursorTracking()
    stopToolbarHolePoll()
    overlaysInteractive = false
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
  stopToolbarHolePoll()
  overlaysInteractive = false
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

/**
 * Hide every PresentOtter-owned window so it does NOT end up baked into a
 * screenshot, then hand back a restore() that re-shows exactly what was
 * hidden (overlays come back inactive, toolbar/home come back focusable).
 * Passed to the capture module as its hideOwnUi dependency.
 */
function hideOwnUiForCapture(): OwnUiState {
  const overlays: BrowserWindow[] = []
  const others: BrowserWindow[] = []
  if (
    toolbarWindow !== null &&
    !toolbarWindow.isDestroyed() &&
    toolbarWindow.isVisible()
  ) {
    others.push(toolbarWindow)
  }
  for (const w of overlayWindows.values()) {
    if (!w.isDestroyed() && w.isVisible()) overlays.push(w)
  }
  if (
    homeWindow !== null &&
    !homeWindow.isDestroyed() &&
    homeWindow.isVisible() &&
    !homeWindow.isMinimized()
  ) {
    others.push(homeWindow)
  }
  for (const w of overlays) w.hide()
  for (const w of others) w.hide()
  return {
    restore: () => {
      for (const w of overlays) if (!w.isDestroyed()) w.showInactive()
      for (const w of others) if (!w.isDestroyed()) w.show()
    }
  }
}

// ============================================================================
// Fan-out helpers — IPC reaches every alive overlay
// ============================================================================

function forwardToOverlays<T>(channel: string, payload?: T): void {
  for (const w of overlayWindows.values()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/**
 * Apply a single click-through state to every overlay.
 *   interactive=true  → overlay captures the pointer (drawing)
 *   interactive=false → overlay is click-through (events pass beneath)
 */
function applyOverlayClickThrough(interactive: boolean): void {
  for (const w of overlayWindows.values()) {
    if (w.isDestroyed()) continue
    if (interactive) w.setIgnoreMouseEvents(false)
    else w.setIgnoreMouseEvents(true, { forward: true })
  }
}

/**
 * "Toolbar hole" poll. On Windows the `relativeLevel` argument of
 * setAlwaysOnTop is a no-op, so an interactive (mouse-capturing) overlay
 * at the same 'screen-saver' tier can sit ABOVE the toolbar and steal
 * its clicks — the user draws instead of clicking an icon. Fighting the
 * z-order via moveTop() proved unreliable, and it breaks on multi-monitor
 * setups.
 *
 * Deterministic fix: while a drawing tool is active, poll the global
 * cursor position. When it enters the toolbar window's rectangle, make
 * the overlays click-through so the click falls through to the toolbar;
 * when it leaves, make them interactive again so drawing resumes. All
 * coordinates are global DIP screen coords (getCursorScreenPoint +
 * getBounds), so this works identically on every display.
 */
let overlaysInteractive = false
let toolbarHoleInterval: ReturnType<typeof setInterval> | null = null
let holeOpen = false

function pointInToolbar(x: number, y: number): boolean {
  if (toolbarWindow === null || toolbarWindow.isDestroyed()) return false
  if (!toolbarWindow.isVisible()) return false
  const b = toolbarWindow.getBounds()
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
}

function startToolbarHolePoll(): void {
  if (toolbarHoleInterval !== null) return
  holeOpen = false
  toolbarHoleInterval = setInterval(() => {
    if (!overlaysInteractive) return
    const pt = screen.getCursorScreenPoint()
    const over = pointInToolbar(pt.x, pt.y)
    if (over === holeOpen) return // no state change, skip the IPC churn
    holeOpen = over
    // over toolbar → overlays click-through (toolbar gets the click)
    // elsewhere     → overlays interactive (drawing works)
    applyOverlayClickThrough(!over)
  }, 40)
}

function stopToolbarHolePoll(): void {
  if (toolbarHoleInterval !== null) {
    clearInterval(toolbarHoleInterval)
    toolbarHoleInterval = null
  }
  holeOpen = false
}

function setOverlaysInteractive(interactive: boolean): void {
  overlaysInteractive = interactive
  if (interactive) {
    // Start in the interactive state, then let the hole poll punch a
    // click-through hole whenever the cursor is over the toolbar.
    applyOverlayClickThrough(true)
    startToolbarHolePoll()
  } else {
    stopToolbarHolePoll()
    applyOverlayClickThrough(false)
  }
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

  // Updates — see src/main/updater.ts. The renderer triggers a check,
  // we hit the GitHub Releases API. If the user opts in, we download
  // the installer to %TEMP%\presentotter-updates\ and launch it.
  ipcMain.handle('updates:check', async (): Promise<UpdateCheck> => {
    return await checkForUpdate()
  })
  ipcMain.handle('updates:download-and-launch', async (event, url: string) => {
    return await downloadAndLaunch(url, (downloaded, total) => {
      // Progress fan-out so the renderer can drive a bar.
      event.sender.send('updates:download-progress', { downloaded, total })
    })
  })
  /**
   * Renderer asks to reveal the downloaded installer in Explorer —
   * the SAC-block escape hatch. Right-click → Properties → Unblock
   * (or just double-click from there) lets the user past Smart App
   * Control when the shell launcher itself got rejected.
   */
  ipcMain.handle('updates:reveal-installer', async (_e, filePath: string) => {
    await revealInExplorer(filePath)
  })

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
  /** Cheap: which display is the cursor on right now? The live engine
   *  polls this every scan and re-acquires its capture when the value
   *  changes, so the sanitizer follows the user across monitors instead
   *  of being stuck on whichever screen it started on. */
  ipcMain.handle('live:cursor-display-id', () => {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  })

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

  /**
   * Mirror page asks for the list of capturable displays. Each entry
   * carries the desktopCapturer sourceId (for getUserMedia) + the CSS
   * bounds + DPI so the renderer can choose the right one and render at
   * the matching aspect ratio.
   */
  ipcMain.handle('mirror:list-displays', async () => {
    const displays = screen.getAllDisplays()
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    })
    return displays.map((d) => {
      const wanted = String(d.id)
      const match = sources.find(
        (s: Electron.DesktopCapturerSource & { display_id?: string }) =>
          s.display_id === wanted
      ) ?? sources[0]
      return {
        displayId: d.id,
        sourceId: match?.id ?? '',
        label: match?.name ?? `Écran ${d.id}`,
        bounds: d.bounds,
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === screen.getPrimaryDisplay().id
      }
    })
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
    const b = toolbarWindow.getBounds()
    // Restore to whatever the renderer asked for last (horizontal default).
    // The restore IPC sets size, the renderer separately drives orientation
    // via toolbar:set-bounds when applicable.
    const W = 1180
    const H = 112
    const { x, y } = clampToolbarPosition(b.x, b.y, W, H)
    toolbarWindow.setBounds({ x, y, width: W, height: H })
  })
  /**
   * Renderer asks to resize the toolbar window vertically. Used by the
   * color popover so it can render below the capsule without being
   * clipped at the bottom edge. The clamp keeps the resized window
   * fully on-screen even if the capsule was near a screen edge.
   */
  ipcMain.on('toolbar:set-height', (_e, height: number) => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    const b = toolbarWindow.getBounds()
    const safeH = Math.max(80, Math.min(900, Math.floor(height)))
    const { x, y } = clampToolbarPosition(b.x, b.y, b.width, safeH)
    toolbarWindow.setBounds({ x, y, width: b.width, height: safeH })
  })
  /**
   * Renderer asks to relocate the toolbar window. Used by the minimized
   * bubble + (eventually) vertical-dock snap. The clamp keeps the
   * window on-screen even if the user dragged it past a display edge.
   */
  ipcMain.on('toolbar:set-position', (_e, point: { x: number; y: number }) => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    if (typeof point?.x !== 'number' || typeof point?.y !== 'number') return
    const b = toolbarWindow.getBounds()
    const { x, y } = clampToolbarPosition(Math.floor(point.x), Math.floor(point.y), b.width, b.height)
    toolbarWindow.setBounds({ x, y, width: b.width, height: b.height })
  })
  /**
   * Atomic resize+position: used by the vertical-dock toggle so we go
   * from "horizontal at (X, Y)" to "vertical at right edge of current
   * display" in a single window operation (avoiding a flash of the
   * old shape at the wrong position).
   */
  ipcMain.on(
    'toolbar:set-bounds',
    (_e, b: { x: number; y: number; width: number; height: number }) => {
      if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
      if (
        typeof b?.x !== 'number' ||
        typeof b?.y !== 'number' ||
        typeof b?.width !== 'number' ||
        typeof b?.height !== 'number'
      ) {
        return
      }
      const safeW = Math.max(60, Math.min(2000, Math.floor(b.width)))
      const safeH = Math.max(60, Math.min(2000, Math.floor(b.height)))
      const { x, y } = clampToolbarPosition(
        Math.floor(b.x),
        Math.floor(b.y),
        safeW,
        safeH
      )
      toolbarWindow.setBounds({ x, y, width: safeW, height: safeH })
    }
  )
  /**
   * Renderer asks for the bounds of the display the toolbar is on
   * right now. Used by the vertical-dock toggle to snap to that
   * display's right edge.
   */
  ipcMain.handle('toolbar:current-display-bounds', () => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return null
    const b = toolbarWindow.getBounds()
    // Center point of the window — the display containing that point
    // is the "current" display.
    const cx = b.x + Math.floor(b.width / 2)
    const cy = b.y + Math.floor(b.height / 2)
    const d = screen.getDisplayNearestPoint({ x: cx, y: cy })
    return { workArea: d.workArea, scaleFactor: d.scaleFactor }
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
  ipcMain.on('overlay:set-ephemeral-life', (_e, ms: number) =>
    forwardToOverlays('overlay:set-ephemeral-life', ms)
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
    { accel: 'Alt+E', fn: () => selectToolFromShortcut('ephemeral') },
    { accel: 'Alt+R', fn: () => selectToolFromShortcut('rectangle') },
    { accel: 'Alt+O', fn: () => selectToolFromShortcut('circle') },
    { accel: 'Alt+A', fn: () => selectToolFromShortcut('arrow') },
    { accel: 'Alt+T', fn: () => selectToolFromShortcut('text') },
    { accel: 'Alt+L', fn: () => selectToolFromShortcut('spotlight') },
    { accel: 'Alt+F', fn: () => selectToolFromShortcut('blur') },
    { accel: 'Alt+Z', fn: () => forwardToOverlays('overlay:undo') },
    { accel: 'Alt+Shift+C', fn: () => forwardToOverlays('overlay:clear') },
    // Screen capture — Snipping-Tool replacement. Default trigger; the
    // Settings page will let the user rebind it (phase 4).
    { accel: 'Alt+Shift+S', fn: () => void startCapture('photo') },
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
    // Escape is handled via uiohook (see setEscapeHandler in startup)
    // rather than globalShortcut because the latter silently fails when
    // another running app owns the accelerator — which is the rule
    // rather than the exception for Escape.
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
    // Kill the default application menu (File / Edit / View / Window /
    // Help). With frame:false on the toolbar the menu was leaking
    // through as a thin band underneath the capsule whenever Alt was
    // pressed — Windows pops the menu mnemonic overlay on Alt, and our
    // global Alt+P / Alt+R shortcuts trigger that path. Nuking the
    // menu entirely also speeds up Alt-shortcuts a hair.
    Menu.setApplicationMenu(null)
    // Stable AppUserModelID — required on Windows for native notifications
    // (toast) to render with our identity and for their click events to
    // fire. The capture flow relies on the "click to edit" notification.
    app.setAppUserModelId('com.otterwise.presentotter')
    configureDisplayMedia()
    registerIpcHandlers()
    registerCaptureIpc({
      rendererUrl,
      preloadPath: path.join(__dirname, 'preload.js'),
      hideOwnUi: hideOwnUiForCapture,
      isDev
    })
    homeWindow = createHomeWindow()
    registerGlobalShortcuts()
    setupDisplayHotPlug()
    startTripleAltDetector(handleTripleAlt)
    // Backup Escape handler via uiohook: Electron's globalShortcut
    // for Escape silently fails when another running app already owns
    // the accelerator (Chrome, Word, anything with a modal). uiohook
    // taps the raw OS stream so we always see the press, and crucially
    // doesn't consume it — the focused app still receives Escape.
    setEscapeHandler(() => selectToolFromShortcut('select'))
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
