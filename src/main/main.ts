import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  screen,
  session,
  shell,
  Tray,
  type Display,
  type WebContents
} from 'electron'
import {
  promises as fsp,
  accessSync,
  createReadStream,
  writeFileSync,
  constants as fsConstants
} from 'node:fs'
import { Readable } from 'node:stream'
import { deflateSync } from 'node:zlib'
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
  isRegionRecording,
  stopRegionRecording,
  type OwnUiState
} from './capture'
import {
  getCaptureHotkeys,
  setCaptureHotkeys,
  getDefaultCaptureHotkeys,
  getCaptureFps,
  setCaptureFps,
  type CaptureHotkeys,
  type CaptureFps
} from './app-settings'
import { startUia, stopUia } from './uia-scanner'
import { registerVideoEditorIpc } from './video-editor'

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
let tray: Tray | null = null
/** True once the user explicitly chose to quit (tray → Quitter / before-quit),
 *  so closing the last window keeps the app alive in the tray otherwise. */
let isQuitting = false
const overlayWindows = new Map<number, BrowserWindow>() // keyed by Display.id
let cursorInterval: ReturnType<typeof setInterval> | null = null
let cursorHighlightOn = false
/** True while the spotlight tool is selected. Drives the same cursor
 *  poll as `cursorHighlightOn` so the overlay can draw a dark wash
 *  with a clear circle that follows the mouse, no drag required. */
let spotlightActive = false
/** True while the toolbar's LIVE sanitizer runs. Overlays must stay alive
 *  the whole time — they are what draws the shield masks over secrets. */
let liveSanitizerActive = false

/** Last payload pushed on each sticky overlay channel (tool, color, cursor
 *  settings…). Replayed into freshly created overlay windows so overlays
 *  respawned after an idle teardown come back with the user's state. */
const overlayStickyState = new Map<string, unknown>()

let overlayIdleTimer: ReturnType<typeof setTimeout> | null = null
/** Grace before unused overlays are torn down. Must outlive the longest
 *  ephemeral-stroke fade (clamped to 20 s in useToolSettingsStore) so a
 *  freshly drawn stroke never vanishes early with its window. */
const OVERLAY_IDLE_MS = 30_000

const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:5173'
const CURSOR_POLL_MS = 16

// Custom scheme the video editor uses to STREAM a local recording into a
// <video> element (Range-request seekable) instead of copying the whole file
// over IPC. Must be declared before app 'ready', hence top-level.
const MEDIA_SCHEME = 'po-media'
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
      // The editor's <video crossOrigin="anonymous"> + WebAudio graph need
      // real CORS semantics on this scheme (see registerMediaProtocol).
      corsEnabled: true
    }
  }
])

const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska'
}

/**
 * Serve files under Videos\PresentOtter over `po-media://`, with REAL HTTP
 * Range support (206 + Content-Range). Chromium's media stack seeks by
 * requesting "bytes=N-"; answering with the whole file from 0 (what
 * net.fetch(file://) does — it ignores the Range header) makes every seek
 * snap back to the start of the video. So we stream the requested byte
 * window ourselves with fs.createReadStream.
 *
 * Access-Control-Allow-Origin is required because the editor pipes the
 * <video crossOrigin="anonymous"> through WebAudio (gain + VU meter):
 * without CORS approval, createMediaElementSource outputs pure silence.
 *
 * The path is clamped to the recordings root so a renderer can't read
 * arbitrary files through this scheme.
 */
function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const p = new URL(request.url).searchParams.get('p')
      if (p === null) return new Response('missing path', { status: 400 })
      const full = path.resolve(decodeURIComponent(p))
      const root = path.resolve(path.join(app.getPath('videos'), 'PresentOtter'))
      if (full !== root && !full.startsWith(root + path.sep)) {
        return new Response('forbidden', { status: 403 })
      }
      const stat = await fsp.stat(full)
      const total = stat.size
      const baseHeaders: Record<string, string> = {
        'Content-Type': MEDIA_MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }

      const range = request.headers.get('range')
      const m = range !== null ? /bytes=(\d*)-(\d*)/.exec(range) : null
      if (m !== null && (m[1] !== '' || m[2] !== '')) {
        // "bytes=a-b" | "bytes=a-" | "bytes=-suffix" (last N bytes).
        let start: number
        let end: number
        if (m[1] === '') {
          const suffix = Number(m[2])
          start = Math.max(0, total - suffix)
          end = total - 1
        } else {
          start = Number(m[1])
          end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1)
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
          return new Response(null, {
            status: 416,
            headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` }
          })
        }
        const stream = createReadStream(full, { start, end })
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1)
          }
        })
      }

      const stream = createReadStream(full)
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(total) }
      })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}

function rendererUrl(
  hash:
    | 'home'
    | 'toolbar'
    | 'overlay'
    | 'capture'
    | 'editor'
    | 'recorder'
    | 'video-editor'
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
    icon: loadCachedAppIcon() ?? makeDiscIcon(256),
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
  // Force the bounds in screen coordinates. The BrowserWindow constructor
  // interprets width/height with the PRIMARY display's DPI, so on a
  // secondary monitor with a different scale the overlay comes out the
  // wrong size — annotations and cursor effects then only cover part of
  // that screen (or none of it). setBounds re-applies them in the target
  // screen's own DPI so the overlay truly covers that display. Same fix
  // as the capture windows (see capture.ts createCaptureWindow).
  win.setBounds({ x, y, width, height })

  // Replay the sticky overlay state (tool, color, stroke, cursor settings…)
  // once the renderer is ready to receive IPC. Without this, an overlay
  // respawned after an idle teardown (see syncOverlayLifecycle) would boot
  // with defaults while the toolbar still shows the user's selections.
  win.webContents.on('did-finish-load', () => {
    for (const [channel, payload] of overlayStickyState) {
      win.webContents.send(channel, payload)
    }
  })

  void win.loadURL(rendererUrl('overlay'))

  win.once('ready-to-show', () => {
    win.showInactive()
    // Re-assert the bounds after show — Windows can resize a frameless
    // window on first paint (the mixed-DPI "micro window" problem).
    win.setBounds({ x, y, width, height })
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
    // The LIVE sanitizer lived in this renderer: its React cleanup never
    // runs when the window is destroyed, so the native UIA scanner (a
    // PowerShell child scanning every 500 ms) would keep running forever.
    // Kill it from here, and drop the session's overlay state with it.
    stopUia()
    liveSanitizerActive = false
    if (overlayIdleTimer !== null) {
      clearTimeout(overlayIdleTimer)
      overlayIdleTimer = null
    }
    overlayStickyState.clear()
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
  // Warm start: overlays come up with the toolbar so the first tool click
  // draws instantly. If the user doesn't touch a tool, syncOverlayLifecycle
  // tears them down after OVERLAY_IDLE_MS and respawns on demand.
  spawnOverlayForAllDisplays()
  toolbarWindow = createToolbarWindow()
  syncOverlayLifecycle()
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
  stopUia()
  liveSanitizerActive = false
  if (overlayIdleTimer !== null) {
    clearTimeout(overlayIdleTimer)
    overlayIdleTimer = null
  }
  overlayStickyState.clear()
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
  let home: BrowserWindow | null = null
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
    home = homeWindow
  }
  for (const w of overlays) w.hide()
  for (const w of others) w.hide()
  if (home !== null) home.hide()
  // showInactive everywhere: restoring our windows must NOT steal focus
  // from whatever app the user is capturing — the "retour Windows" jolt
  // after every screenshot was exactly this.
  const restoreNonHome = (): void => {
    for (const w of overlays) if (!w.isDestroyed()) w.showInactive()
    for (const w of others) if (!w.isDestroyed()) w.showInactive()
  }
  const restoreHome = (): void => {
    if (home !== null && !home.isDestroyed()) home.showInactive()
  }
  return {
    restoreNonHome,
    restoreHome,
    restore: () => {
      restoreNonHome()
      restoreHome()
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

/** forwardToOverlays + remember the payload so overlays created later
 *  (respawn after idle teardown) receive it on did-finish-load. Use for
 *  STATE channels only — never for one-shot commands like undo/clear. */
function forwardToOverlaysSticky<T>(channel: string, payload?: T): void {
  overlayStickyState.set(channel, payload)
  forwardToOverlays(channel, payload)
}

/** Something currently requires a live overlay window. */
function overlaysNeeded(): boolean {
  return (
    overlaysInteractive || cursorHighlightOn || spotlightActive || liveSanitizerActive
  )
}

/**
 * Overlay windows are one full renderer process PER DISPLAY — the biggest
 * idle RAM cost of the app while the toolbar is on. Annotations are
 * short-lived by design (ephemeral strokes cap at 20 s), so when nothing
 * has needed an overlay for OVERLAY_IDLE_MS we close the windows and
 * recreate them on the next activation (tool selected, cursor highlight,
 * spotlight, LIVE sanitizer). Fresh windows get the sticky state replayed
 * so the teardown is invisible to the user — apart from the freed RAM.
 */
function syncOverlayLifecycle(): void {
  if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
  if (overlaysNeeded()) {
    if (overlayIdleTimer !== null) {
      clearTimeout(overlayIdleTimer)
      overlayIdleTimer = null
    }
    spawnOverlayForAllDisplays()
    return
  }
  if (overlayWindows.size === 0 || overlayIdleTimer !== null) return
  overlayIdleTimer = setTimeout(() => {
    overlayIdleTimer = null
    if (overlaysNeeded()) return
    for (const w of overlayWindows.values()) {
      if (!w.isDestroyed()) w.close()
    }
    overlayWindows.clear()
  }, OVERLAY_IDLE_MS)
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
  // Spawn missing overlays before touching their click-through state, or
  // arm the idle teardown when the tool was just deselected.
  syncOverlayLifecycle()
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

/** Re-apply all global shortcuts after a hotkey rebind. unregisterAll only
 *  touches Electron globalShortcut entries (Escape stays on uiohook). */
function reRegisterShortcuts(): void {
  globalShortcut.unregisterAll()
  registerGlobalShortcuts()
}

function registerIpcHandlers(): void {
  ipcMain.handle('window:get-role', (event) => getWindowRole(event.sender))
  ipcMain.handle('app:version', () => app.getVersion())
  // Renderer hands us the mascot rasterized to PNG → tray + window icon.
  ipcMain.on('app:set-icon', (_e, dataUrl: string) => applyAppIcon(dataUrl))
  ipcMain.handle('toolbar:is-enabled', () => toolbarWindow !== null && !toolbarWindow.isDestroyed())

  // Capture hotkeys — read/rebind. Persisted in app-settings (userData).
  ipcMain.handle('settings:get-capture-hotkeys', () => getCaptureHotkeys())
  ipcMain.handle('settings:default-capture-hotkeys', () =>
    getDefaultCaptureHotkeys()
  )
  ipcMain.handle(
    'settings:set-capture-hotkeys',
    (_e, next: Partial<CaptureHotkeys>) => {
      const saved = setCaptureHotkeys(next)
      reRegisterShortcuts()
      // Report whether each capture accel actually grabbed (another app
      // owning it makes register() fail → isRegistered false).
      return {
        hotkeys: saved,
        capturePhotoOk: globalShortcut.isRegistered(saved.capturePhoto),
        captureVideoOk: globalShortcut.isRegistered(saved.captureVideo)
      }
    }
  )

  // Recording frame rate — persisted so the user's choice sticks across
  // sessions and actually drives the recorders (region + full screen).
  ipcMain.handle('settings:get-capture-fps', () => getCaptureFps())
  ipcMain.handle('settings:set-capture-fps', (_e, fps: CaptureFps) =>
    setCaptureFps(fps === 30 ? 30 : 60)
  )

  // Run in background + start with Windows so capture works any time.
  ipcMain.handle('settings:get-open-at-login', () => getOpenAtLogin())
  ipcMain.handle('settings:set-open-at-login', (_e, enabled: boolean) => {
    setOpenAtLogin(enabled === true)
    return getOpenAtLogin()
  })

  // UI-Automation sanitizer (fast path). The renderer starts it when LIVE
  // is on in 'uia' / 'hybrid' mode; main streams detected masks back to the
  // toolbar, which feeds them into the same sticky-mask pool as OCR.
  ipcMain.on('live:uia-start', (e) => {
    startUia((elements) => {
      // The subscribing renderer is gone (window closed mid-LIVE) — kill
      // the PowerShell scanner instead of letting it poll for nobody.
      if (e.sender.isDestroyed()) {
        stopUia()
        return
      }
      e.sender.send('live:uia-elements', elements)
    })
  })
  ipcMain.on('live:uia-stop', () => stopUia())

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

  /** Library: list every saved recording on disk (Videos\PresentOtter and its
   *  Edits subfolder), newest first. This is the real source of truth the
   *  library UI reads — recordings are written straight to disk, not to a DB. */
  ipcMain.handle('recordings:list', async () => {
    const root = path.join(app.getPath('videos'), 'PresentOtter')
    const targets: Array<{ dir: string; folder: 'recordings' | 'edits' }> = [
      { dir: root, folder: 'recordings' },
      { dir: path.join(root, 'Edits'), folder: 'edits' }
    ]
    const exts = new Set(['.mp4', '.webm', '.mov', '.mkv'])
    const out: Array<{
      path: string
      name: string
      ext: string
      sizeBytes: number
      mtimeMs: number
      folder: 'recordings' | 'edits'
    }> = []
    for (const { dir, folder } of targets) {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        continue // folder doesn't exist yet
      }
      for (const e of entries) {
        if (!e.isFile()) continue
        const ext = path.extname(e.name).toLowerCase()
        if (!exts.has(ext)) continue
        const full = path.join(dir, e.name)
        try {
          const st = await fsp.stat(full)
          out.push({
            path: full,
            name: e.name,
            ext: ext.replace('.', ''),
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
            folder
          })
        } catch {
          /* file vanished between readdir and stat — skip */
        }
      }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return out
  })

  /** Library: send a recording to the Recycle Bin (reversible). */
  ipcMain.handle('recordings:delete', async (_e, filePath: string) => {
    try {
      await shell.trashItem(filePath)
      return true
    } catch {
      return false
    }
  })

  /** Library: rename a recording on disk, keeping its extension. Returns the
   *  new absolute path, or null on failure. */
  ipcMain.handle(
    'recordings:rename',
    async (_e, filePath: string, newBase: string) => {
      try {
        const dir = path.dirname(filePath)
        const ext = path.extname(filePath)
        const safe = newBase
          .trim()
          .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
          .replace(/\.(mp4|webm|mov|mkv)$/i, '')
          .slice(0, 180)
        if (safe.length === 0) return null
        const target = path.join(dir, `${safe}${ext}`)
        await fsp.rename(filePath, target)
        return target
      } catch {
        return null
      }
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

  // Toolbar → Overlay(s). Sticky: replayed into overlays respawned after
  // an idle teardown (see syncOverlayLifecycle).
  ipcMain.on('overlay:set-tool', (_e, tool: string) =>
    forwardToOverlaysSticky('overlay:set-tool', tool)
  )
  ipcMain.on('overlay:set-color', (_e, hex: string) =>
    forwardToOverlaysSticky('overlay:set-color', hex)
  )
  ipcMain.on('overlay:set-opacity', (_e, value: number) =>
    forwardToOverlaysSticky('overlay:set-opacity', value)
  )
  ipcMain.on('overlay:set-stroke', (_e, width: number) =>
    forwardToOverlaysSticky('overlay:set-stroke', width)
  )
  ipcMain.on('overlay:set-ephemeral-life', (_e, ms: number) =>
    forwardToOverlaysSticky('overlay:set-ephemeral-life', ms)
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

  /** An overlay asks which display it lives on. Authoritative id + DIP
   *  bounds from main — window.screenX/Y in the renderer is unreliable on
   *  mixed-DPI multi-monitor setups, which broke cursor-effect mapping on
   *  every screen except the primary. */
  ipcMain.handle('overlay:get-display', (event) => {
    for (const [displayId, w] of overlayWindows) {
      if (w.isDestroyed() || w.webContents.id !== event.sender.id) continue
      const d = screen.getAllDisplays().find((dd) => dd.id === displayId)
      if (d !== undefined) {
        return { id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }
      }
      return { id: displayId, bounds: w.getBounds(), scaleFactor: 1 }
    }
    return null
  })

  ipcMain.on('overlay:set-live-masks', (_e, zones: unknown) => {
    forwardToOverlays('overlay:set-live-masks', zones)
  })
  ipcMain.on('overlay:clear-live-masks', () => {
    forwardToOverlays('overlay:clear-live-masks')
  })
  // Overlay → toolbar: a mask was dismissed by the user. Route it to the
  // toolbar window (where masks are generated) so it stops re-emitting it.
  ipcMain.on('sanitizer:dismiss-mask', (_e, region: unknown) => {
    if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
      toolbarWindow.webContents.send('sanitizer:dismiss-mask', region)
    }
  })
  ipcMain.on('overlay:set-live-ocr-words', (_e, words: unknown) => {
    forwardToOverlays('overlay:set-live-ocr-words', words)
  })
  ipcMain.on('overlay:clear-live-ocr-words', () => {
    forwardToOverlays('overlay:clear-live-ocr-words')
  })

  ipcMain.on('cursor:set-highlight', (_e, enabled: boolean) => {
    cursorHighlightOn = enabled
    syncOverlayLifecycle()
    forwardToOverlaysSticky('cursor:set-highlight', enabled)
    if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
      toolbarWindow.webContents.send('toolbar:cursor-highlight-changed', enabled)
    }
    syncCursorTracking()
  })

  ipcMain.on('spotlight:set-active', (_e, active: boolean) => {
    spotlightActive = active
    syncOverlayLifecycle()
    forwardToOverlaysSticky('spotlight:set-active', active)
    syncCursorTracking()
  })
  ipcMain.on('cursor:set-color', (_e, hex: string) => {
    forwardToOverlaysSticky('cursor:set-color', hex)
  })
  ipcMain.on('cursor:set-settings', (_e, settings: unknown) => {
    forwardToOverlaysSticky('cursor:set-settings', settings)
  })

  // Toolbar LIVE sanitizer on/off. Overlays draw the shield masks, so they
  // must stay alive (exempt from the idle teardown) while LIVE runs.
  ipcMain.on('live:set-active', (_e, active: boolean) => {
    liveSanitizerActive = active === true
    syncOverlayLifecycle()
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
  // setOverlaysInteractive first: it respawns idle-closed overlays, which
  // then pick the sticky set-tool up on did-finish-load.
  setOverlaysInteractive(tool !== 'select')
  forwardToOverlaysSticky('overlay:set-tool', tool)
  toolbarWindow.webContents.send('toolbar:tool-changed', tool)
}

function registerGlobalShortcuts(): void {
  const hotkeys = getCaptureHotkeys()
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
    // Screen capture — Snipping-Tool replacement. Accelerators come from
    // persisted settings (rebind in Paramètres), defaulting to Alt+Shift+S
    // / Alt+Shift+R.
    { accel: hotkeys.capturePhoto, fn: () => void startCapture('photo') },
    // Region video — toggles: start the region picker, or stop an active
    // recording. ShareX-style.
    {
      accel: hotkeys.captureVideo,
      fn: () => {
        if (isRegionRecording()) stopRegionRecording()
        else void startCapture('video')
      }
    },
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
  syncOverlayLifecycle()
  forwardToOverlaysSticky('cursor:set-highlight', cursorHighlightOn)
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
      // Keep the renderer's screen-space mapping in sync (cursor effects,
      // OCR masks) after a resolution / scale / arrangement change.
      w.webContents.send('overlay:display-changed', {
        id: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor
      })
    }
  })
}

// ============================================================================
// System tray — keeps PresentOtter alive in the background so the global
// capture shortcuts work even with no window open.
// ============================================================================

/** Minimal PNG (RGBA, no compression filter) — reliable across platforms,
 *  unlike createFromBitmap which silently produced an empty image (so the
 *  tray fell back to the default Electron logo). */
function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] ?? 0
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw)
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** A mint disc icon at the given size — used for the tray and the window
 *  icon so we don't need to ship an .ico. */
function makeDiscIcon(size: number): Electron.NativeImage {
  const rgba = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const r = size / 2 - Math.max(1, size * 0.06)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      const a = d <= r ? 1 : d <= r + 1.2 ? r + 1.2 - d : 0
      rgba[i] = 0x2b // R
      rgba[i + 1] = 0xd9 // G
      rgba[i + 2] = 0xac // B
      rgba[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255)
    }
  }
  return nativeImage.createFromBuffer(encodePng(size, size, rgba))
}

/** Where the renderer-rasterized mascot PNG is cached so the otter icon is
 *  available from the very first frame on subsequent launches. */
function appIconCachePath(): string {
  return path.join(app.getPath('userData'), 'app-icon.png')
}

/** The cached mascot icon if we have one, else null (→ disc fallback). */
function loadCachedAppIcon(): Electron.NativeImage | null {
  try {
    const img = nativeImage.createFromPath(appIconCachePath())
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

/** Receive the PNG icon from the renderer (it can decode the webp mascot,
 *  main can't): cache it and apply it to the tray + Home window. */
function applyAppIcon(dataUrl: string): void {
  const img = nativeImage.createFromDataURL(dataUrl)
  if (img.isEmpty()) return
  try {
    writeFileSync(appIconCachePath(), img.toPNG())
  } catch {
    /* cache write failed — icon still applies for this session */
  }
  if (tray !== null && !tray.isDestroyed()) {
    tray.setImage(img.resize({ width: 16, height: 16 }))
  }
  if (homeWindow !== null && !homeWindow.isDestroyed()) {
    homeWindow.setIcon(img.resize({ width: 256, height: 256 }))
  }
}

// `--hidden` so a login launch starts straight into the tray (no window).
// IMPORTANT: on Windows `getLoginItemSettings` only reports `openAtLogin: true`
// when you pass it the *same* args used at set-time, so both paths share this.
const LOGIN_ITEM_ARGS = ['--hidden']

function getOpenAtLogin(): boolean {
  return app.getLoginItemSettings({ args: LOGIN_ITEM_ARGS }).openAtLogin
}

function setOpenAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: LOGIN_ITEM_ARGS })
  rebuildTrayMenu()
}

function rebuildTrayMenu(): void {
  if (tray === null) return
  const openAtLogin = getOpenAtLogin()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Capture d\'écran', accelerator: 'Alt+Shift+S', click: () => void startCapture('photo') },
      {
        label: 'Vidéo de zone',
        accelerator: 'Alt+Shift+R',
        click: () => {
          if (isRegionRecording()) stopRegionRecording()
          else void startCapture('video')
        }
      },
      { type: 'separator' },
      { label: 'Ouvrir PresentOtter', click: () => bringHomeToFront() },
      {
        label: 'Démarrer avec Windows',
        type: 'checkbox',
        checked: openAtLogin,
        click: (item) => setOpenAtLogin(item.checked)
      },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

/**
 * Notify the user after a capture, in a way that survives PresentOtter
 * running with no visible window (tray-only background mode — the normal
 * state after closing Home, or after a `--hidden` login launch).
 *
 * A Windows toast (`Notification`) needs the app's AppUserModelID to match
 * an installed Start Menu shortcut, which our Inno Setup installer does not
 * currently guarantee — when it doesn't match, `notif.show()` fails
 * silently (no error, no toast). The tray balloon (`Tray.displayBalloon`)
 * has no such requirement: it is anchored to the tray icon's own HWND,
 * which is always alive whenever a capture can even be triggered (the tray
 * is created before the global shortcuts are registered). So it is the
 * reliable path; `Notification` is kept only as a non-Windows / no-tray
 * fallback.
 */
function showCaptureNotification(opts: {
  title: string
  body: string
  onClick: () => void
}): void {
  if (tray !== null && !tray.isDestroyed() && process.platform === 'win32') {
    // Only one capture is ever pending at a time, but guard against a
    // stale handler firing for an old balloon if a second capture lands
    // before the first balloon is dismissed.
    tray.removeAllListeners('balloon-click')
    tray.once('balloon-click', opts.onClick)
    tray.displayBalloon({ title: opts.title, content: opts.body })
    return
  }
  if (!Notification.isSupported()) return
  const notif = new Notification({ title: opts.title, body: opts.body, silent: false })
  notif.on('click', opts.onClick)
  notif.show()
}

function createTray(): void {
  if (tray !== null) return
  const cached = loadCachedAppIcon()
  tray = new Tray(cached !== null ? cached.resize({ width: 16, height: 16 }) : makeDiscIcon(16))
  tray.setToolTip('PresentOtter — capture & annotation')
  rebuildTrayMenu()
  // Left-click opens the app; the menu is on right-click (Windows default).
  tray.on('click', () => bringHomeToFront())
}

// ============================================================================
// Lifecycle
// ============================================================================

// Single instance: a second launch (double-click while in tray, or login
// item firing twice) just focuses the running one instead of duplicating.
const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  bringHomeToFront()
})

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
    registerMediaProtocol()
    registerIpcHandlers()
    createTray()
    registerCaptureIpc({
      rendererUrl,
      preloadPath: path.join(__dirname, 'preload.js'),
      hideOwnUi: hideOwnUiForCapture,
      showNotification: showCaptureNotification
    })
    registerVideoEditorIpc({
      rendererUrl,
      preloadPath: path.join(__dirname, 'preload.js'),
      locateFfmpeg
    })
    // When launched at login (or with --hidden) we start straight into the
    // tray so capture shortcuts are armed without popping a window.
    const startHidden =
      process.argv.includes('--hidden') ||
      app.getLoginItemSettings().wasOpenedAtLogin
    if (!startHidden) {
      homeWindow = createHomeWindow()
    }
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

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  stopCursorTracking()
  stopTripleAltDetector()
  stopUia()
  globalShortcut.unregisterAll()
  if (tray !== null) {
    tray.destroy()
    tray = null
  }
})

app.on('window-all-closed', () => {
  // Do NOT quit when the last window closes: PresentOtter lives in the tray
  // so its global capture shortcuts keep working in the background. The user
  // exits explicitly via the tray → Quitter (which sets isQuitting). The
  // capture/editor/recorder windows opening and closing therefore never end
  // the process.
  if (isQuitting && process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (homeWindow === null) {
    homeWindow = createHomeWindow()
  }
})
