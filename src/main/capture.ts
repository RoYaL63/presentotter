import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  screen,
  shell,
  type Display,
  type IpcMainInvokeEvent
} from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

/**
 * Capture module — the "Snipping Tool" replacement.
 *
 * Flow (photo):
 *   1. Trigger (global hotkey or Home button) → startCapture('photo').
 *   2. Hide our own floating UI (toolbar/overlays/home) so it is NOT in
 *      the shot, wait a frame, then grab a FULL-RESOLUTION still of every
 *      display via desktopCapturer.
 *   3. Spawn one opaque, always-on-top "capture window" per display, each
 *      showing its frozen frame. The user drags a rectangle on whichever
 *      screen they like (or picks full-screen). Esc cancels.
 *   4. The renderer crops the selection out of the frozen frame at device
 *      resolution and sends the PNG bytes back here.
 *   5. We copy the PNG to the clipboard, save it to Pictures\PresentOtter,
 *      restore the hidden UI, and raise a native notification. Clicking it
 *      opens the editor window on that capture.
 *
 * Video mode reuses steps 1-4 for the region selection, then hands the
 * rectangle to the recorder (see startRegionRecording, phase 3).
 */

export interface CaptureDeps {
  /** Build a renderer URL for a given window hash (dev server or file://). */
  rendererUrl: (hash: 'capture' | 'editor' | 'recorder') => string
  /** Absolute path to the compiled preload script. */
  preloadPath: string
  /** Hide every PresentOtter-owned window that would otherwise appear in
   *  the screenshot. Returns a token whose restore() re-shows them. */
  hideOwnUi: () => OwnUiState
  /** Dev builds: auto-open the editor after a capture, because Windows
   *  toast notifications don't render reliably for an unpackaged app
   *  (they need an installed Start-menu shortcut matching the AUMID). In
   *  production we stay non-intrusive and only notify. */
  isDev: boolean
}

/**
 * Restore token for the windows we hid before a capture. Split so video
 * recording can bring back the small UI (toolbar/overlays) immediately but
 * keep the big Home window hidden until the recording stops — otherwise it
 * would pop into the live region being filmed.
 */
export type OwnUiState = {
  restore: () => void
  restoreNonHome: () => void
  restoreHome: () => void
}

export type CaptureMode = 'photo' | 'video'

interface FramePayload {
  /** Top-left of the virtual desktop (DIP). The overlay spans ALL screens
   *  as one window, so the renderer adds this origin to its local cursor
   *  coords to produce screen-DIP coordinates main can resolve. */
  originX: number
  originY: number
  mode: CaptureMode
}

interface RecorderConfig {
  sourceId: string
  /** Crop rectangle in DEVICE pixels on the source display. */
  rect: { x: number; y: number; width: number; height: number }
  fps: number
}

interface LastCapture {
  path: string | null
  bytes: Buffer
  width: number
  height: number
}

let deps: CaptureDeps | null = null
let capturing = false
const captureWindows = new Set<BrowserWindow>()
const frameByWebContents = new Map<number, FramePayload>()
let pendingRestore: OwnUiState | null = null
let lastCapture: LastCapture | null = null
let editorWindow: BrowserWindow | null = null
let recorderWindow: BrowserWindow | null = null
const recorderConfigByWebContents = new Map<number, RecorderConfig>()

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Find the desktopCapturer screen source for a display. display_id matching
 * is unreliable on Windows, so we fall back to index alignment with the
 * getAllDisplays order. thumbW/H controls the thumbnail resolution (full
 * device pixels for a photo crop, tiny when we only need the source id).
 */
async function getDisplaySource(
  display: Display,
  index: number,
  thumbW: number,
  thumbH: number
): Promise<Electron.DesktopCapturerSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH }
  })
  if (sources.length === 0) return null
  const wanted = String(display.id)
  let match = sources.find(
    (s: Electron.DesktopCapturerSource & { display_id?: string }) =>
      s.display_id === wanted
  )
  if (match === undefined) match = sources[index] ?? sources[0]
  return match ?? null
}

function createCaptureWindow(display: Display, mode: CaptureMode): void {
  if (deps === null) return
  // One window PER display, exactly at its bounds. A single window spanning
  // multiple monitors does not paint reliably across the whole span on
  // Windows (mixed-DPI / large transparent layered window), which left a
  // screen un-dimmed and clipped the selection border. Per-display windows
  // are DPI-correct and always cover their whole screen.
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    // Transparent: the user sees their LIVE screen through a light wash +
    // the selection toolbar — no opaque "window over my content". The
    // actual still is grabbed by main AFTER this overlay is hidden.
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Capture the id up-front: by the time 'closed' fires the webContents is
  // already destroyed, and reading win.webContents.id then throws
  // "Object has been destroyed".
  const wcId = win.webContents.id
  frameByWebContents.set(wcId, {
    originX: x,
    originY: y,
    mode
  })
  captureWindows.add(win)

  void win.loadURL(deps.rendererUrl('capture'))

  win.once('ready-to-show', () => {
    // Another display's window may have already confirmed/cancelled and
    // torn everything down before this fires — guard against the
    // destroyed window.
    if (win.isDestroyed()) return
    win.show()
    win.focus()
    win.setAlwaysOnTop(true, 'screen-saver')
  })
  win.on('closed', () => {
    frameByWebContents.delete(wcId)
    captureWindows.delete(win)
  })
}

/** Close every capture (selection) window. Does NOT touch the restore. */
function closeCaptureWindows(): void {
  for (const w of captureWindows) {
    if (!w.isDestroyed()) w.close()
  }
  captureWindows.clear()
  frameByWebContents.clear()
}

/** Tear down the selection windows and restore ALL the UI we hid. */
function finishCapture(): void {
  closeCaptureWindows()
  if (pendingRestore !== null) {
    pendingRestore.restore()
    pendingRestore = null
  }
  capturing = false
}

/**
 * Entry point — start a capture session in photo or video mode.
 */
export async function startCapture(mode: CaptureMode): Promise<void> {
  if (deps === null || capturing) return
  capturing = true

  // Hide our own floating UI so the user doesn't see (or select) it, and so
  // it won't be in the grab taken at confirm time.
  pendingRestore = deps.hideOwnUi()
  // Let the compositor actually remove our windows before the transparent
  // selector appears over the live screen.
  await delay(120)

  const displays = screen.getAllDisplays()
  if (displays.length === 0) {
    finishCapture()
    return
  }
  // One transparent selector per screen so every display is fully dimmed.
  for (const d of displays) createCaptureWindow(d, mode)
}

/**
 * Map a screen-DIP selection rectangle to the display it belongs to (by its
 * centre) and the device-pixel crop rect on that display. A null rect means
 * "full screen of the display under the cursor".
 */
function resolveSelection(
  screenRect: { x: number; y: number; width: number; height: number } | null
): {
  display: Display
  index: number
  deviceRect: { x: number; y: number; width: number; height: number }
} {
  const displays = screen.getAllDisplays()
  if (screenRect === null) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const sf = display.scaleFactor
    return {
      display,
      index: displays.findIndex((d) => d.id === display.id),
      deviceRect: {
        x: 0,
        y: 0,
        width: Math.round(display.size.width * sf),
        height: Math.round(display.size.height * sf)
      }
    }
  }
  const cx = Math.round(screenRect.x + screenRect.width / 2)
  const cy = Math.round(screenRect.y + screenRect.height / 2)
  const display = screen.getDisplayNearestPoint({ x: cx, y: cy })
  const sf = display.scaleFactor
  return {
    display,
    index: displays.findIndex((d) => d.id === display.id),
    deviceRect: {
      x: Math.round((screenRect.x - display.bounds.x) * sf),
      y: Math.round((screenRect.y - display.bounds.y) * sf),
      width: Math.round(screenRect.width * sf),
      height: Math.round(screenRect.height * sf)
    }
  }
}

/** Build the screenshots directory and return its absolute path. */
async function screenshotsDir(): Promise<string> {
  const root = app.getPath('pictures')
  const dir = path.join(root, 'PresentOtter', 'Captures')
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

function timestampName(ext: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `Capture-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext}`
}

async function saveScreenshot(buf: Buffer): Promise<string | null> {
  try {
    const dir = await screenshotsDir()
    const full = path.join(dir, timestampName('png'))
    await fsp.writeFile(full, buf)
    return full
  } catch (err) {
    console.error('[capture] saveScreenshot failed:', err)
    return null
  }
}

function notifyCaptured(savePath: string | null): void {
  if (!Notification.isSupported()) return
  const notif = new Notification({
    title: 'Capture copiée 🦦',
    body: 'Cliquez pour annoter, recadrer ou enregistrer.',
    silent: false
  })
  notif.on('click', () => {
    openEditor()
  })
  notif.show()
  // Keep a reference to the save path is implicit via lastCapture; the
  // click handler reads lastCapture directly.
  void savePath
}

/**
 * Handle a finished photo selection. The selector is transparent (no frozen
 * frame), so main does the actual grab HERE: close the overlay, let it
 * vanish, capture the chosen display at full resolution, crop to the device
 * rectangle, then copy to clipboard + save + notify.
 */
async function handlePhotoSelected(
  screenRect: { x: number; y: number; width: number; height: number } | null
): Promise<void> {
  closeCaptureWindows()
  // The transparent selector (with its wash) must be gone before the grab.
  await delay(150)

  const { display, index, deviceRect } = resolveSelection(screenRect)
  const devW = Math.round(display.size.width * display.scaleFactor)
  const devH = Math.round(display.size.height * display.scaleFactor)

  let src: Electron.DesktopCapturerSource | null = null
  try {
    src = await getDisplaySource(display, index < 0 ? 0 : index, devW, devH)
  } catch (err) {
    console.error('[capture] grab failed:', err)
  }

  // Grab done — bring our UI back.
  if (pendingRestore !== null) {
    pendingRestore.restore()
    pendingRestore = null
  }
  capturing = false

  if (src === null || src.thumbnail.isEmpty()) return
  const full = src.thumbnail
  const size = full.getSize()
  const cx = Math.max(0, Math.min(size.width - 1, Math.round(deviceRect.x)))
  const cy = Math.max(0, Math.min(size.height - 1, Math.round(deviceRect.y)))
  const cw = Math.max(1, Math.min(size.width - cx, Math.round(deviceRect.width)))
  const ch = Math.max(1, Math.min(size.height - cy, Math.round(deviceRect.height)))
  const cropped = full.crop({ x: cx, y: cy, width: cw, height: ch })
  const buf = cropped.toPNG()
  if (!cropped.isEmpty()) clipboard.writeImage(cropped)

  const savePath = await saveScreenshot(buf)
  const cs = cropped.getSize()
  lastCapture = { path: savePath, bytes: buf, width: cs.width, height: cs.height }
  notifyCaptured(savePath)
  // Dev convenience: open the editor straight away so the full loop is
  // testable without a working OS toast (see CaptureDeps.isDev).
  if (deps?.isDev === true) openEditor()
}

/**
 * Handle a finished video selection: resolve the display's capturer source
 * and hand the rectangle to the region recorder.
 */
async function handleVideoSelected(
  screenRect: { x: number; y: number; width: number; height: number } | null
): Promise<void> {
  closeCaptureWindows()
  const { display, index, deviceRect } = resolveSelection(screenRect)
  let src: Electron.DesktopCapturerSource | null = null
  try {
    src = await getDisplaySource(display, index < 0 ? 0 : index, 150, 100)
  } catch (err) {
    console.error('[capture] video source grab failed:', err)
  }
  if (src === null) {
    finishCapture()
    return
  }
  startRegionRecording(src.id, deviceRect, display.bounds, display.scaleFactor)
}

// ============================================================================
// Editor window (phase 2 wires the renderer; the window plumbing lives here)
// ============================================================================

export function openEditor(): void {
  if (deps === null || lastCapture === null) return
  if (editorWindow !== null && !editorWindow.isDestroyed()) {
    editorWindow.focus()
    editorWindow.webContents.send('editor:load-image', editorImagePayload())
    return
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'PresentOtter — Éditeur de capture',
    backgroundColor: '#0A1F1B',
    show: false,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  editorWindow = win
  void win.loadURL(deps.rendererUrl('editor'))
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    editorWindow = null
  })
}

function editorImagePayload(): {
  dataUrl: string
  width: number
  height: number
} | null {
  if (lastCapture === null) return null
  return {
    dataUrl: `data:image/png;base64,${lastCapture.bytes.toString('base64')}`,
    width: lastCapture.width,
    height: lastCapture.height
  }
}

// ============================================================================
// Region video recording (ShareX-style)
// ============================================================================

const REGION_FPS = 30

/**
 * Place the recorder PANEL (setup + controls + preview) OUTSIDE the recorded
 * region so it gets cropped away, preferring the right of the region, then
 * left, then below, then above, then a display corner as a last resort.
 */
function controlPosition(
  rect: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): { x: number; y: number; width: number; height: number } {
  const W = 360
  const H = 440
  const gap = 12
  const regX = bounds.x + rect.x / scaleFactor
  const regY = bounds.y + rect.y / scaleFactor
  const regW = rect.width / scaleFactor
  const regH = rect.height / scaleFactor
  const dispR = bounds.x + bounds.width
  const dispB = bounds.y + bounds.height
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, v))

  // Right, then left (vertically aligned near the region top).
  if (regX + regW + gap + W <= dispR) {
    return {
      x: Math.round(regX + regW + gap),
      y: Math.round(clamp(regY, bounds.y + 8, dispB - H - 8)),
      width: W,
      height: H
    }
  }
  if (regX - gap - W >= bounds.x) {
    return {
      x: Math.round(regX - gap - W),
      y: Math.round(clamp(regY, bounds.y + 8, dispB - H - 8)),
      width: W,
      height: H
    }
  }
  // Below, then above (horizontally centered on the region).
  const cx = Math.round(clamp(regX + regW / 2 - W / 2, bounds.x + 8, dispR - W - 8))
  if (regY + regH + gap + H <= dispB) {
    return { x: cx, y: Math.round(regY + regH + gap), width: W, height: H }
  }
  if (regY - gap - H >= bounds.y) {
    return { x: cx, y: Math.round(regY - gap - H), width: W, height: H }
  }
  // Last resort: top-right corner of the display (may overlap the region).
  return { x: Math.round(dispR - W - 8), y: Math.round(bounds.y + 8), width: W, height: H }
}

function startRegionRecording(
  sourceId: string,
  rect: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): void {
  if (deps === null) return
  // Bring back the small floating UI now; keep Home hidden until the
  // recording ends so it never pops into the filmed region.
  closeCaptureWindows()
  if (pendingRestore !== null) pendingRestore.restoreNonHome()
  capturing = false

  const pos = controlPosition(rect, bounds, scaleFactor)
  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: pos.width,
    height: pos.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  recorderWindow = win
  const wcId = win.webContents.id
  recorderConfigByWebContents.set(wcId, {
    sourceId,
    rect,
    fps: REGION_FPS
  })
  void win.loadURL(deps.rendererUrl('recorder'))
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  win.on('closed', () => {
    recorderConfigByWebContents.delete(wcId)
    if (recorderWindow === win) recorderWindow = null
    // Safety net: if the recorder died without reporting done (crash, kill),
    // bring Home back so it isn't stranded hidden. The normal recorder:done
    // path nulls pendingRestore before this fires, so it won't double-run.
    if (pendingRestore !== null) {
      pendingRestore.restoreHome()
      pendingRestore = null
    }
  })
}

export function isRegionRecording(): boolean {
  return recorderWindow !== null && !recorderWindow.isDestroyed()
}

/** Ask the recorder renderer to stop (it then saves + reports done). */
export function stopRegionRecording(): void {
  if (recorderWindow !== null && !recorderWindow.isDestroyed()) {
    recorderWindow.webContents.send('recorder:stop')
  }
}

function notifyRecorded(savePath: string | null): void {
  if (!Notification.isSupported()) return
  const notif = new Notification({
    title: 'Zone enregistrée 🦦',
    body:
      savePath !== null
        ? 'Vidéo sauvegardée. Cliquez pour ouvrir le dossier.'
        : 'Enregistrement terminé.',
    silent: false
  })
  if (savePath !== null) {
    notif.on('click', () => shell.showItemInFolder(savePath))
  }
  notif.show()
}

// ============================================================================
// IPC
// ============================================================================

export function registerCaptureIpc(d: CaptureDeps): void {
  deps = d

  /** Home / toolbar trigger. */
  ipcMain.on('capture:start', (_e, mode: CaptureMode) => {
    void startCapture(mode === 'video' ? 'video' : 'photo')
  })

  /** A capture window asks for its frozen frame on load. */
  ipcMain.handle('capture:get-frame', (e: IpcMainInvokeEvent) => {
    return frameByWebContents.get(e.sender.id) ?? null
  })

  /** The user confirmed a selection. */
  ipcMain.on(
    'capture:region-selected',
    (
      _e,
      payload: {
        mode: CaptureMode
        /** Selection in screen-DIP coords, or null for full screen. */
        screenRect: { x: number; y: number; width: number; height: number } | null
      }
    ) => {
      if (payload.mode === 'video') {
        void handleVideoSelected(payload.screenRect)
      } else {
        void handlePhotoSelected(payload.screenRect)
      }
    }
  )

  /** Recorder window asks for its capture config (source + crop rect). */
  ipcMain.handle('recorder:get-config', (e: IpcMainInvokeEvent) => {
    return recorderConfigByWebContents.get(e.sender.id) ?? null
  })

  /** Recorder finished + saved: close the control, restore Home, notify. */
  ipcMain.on('recorder:done', (_e, savePath: string | null) => {
    if (recorderWindow !== null && !recorderWindow.isDestroyed()) {
      recorderWindow.close()
    }
    recorderWindow = null
    if (pendingRestore !== null) {
      pendingRestore.restoreHome()
      pendingRestore = null
    }
    notifyRecorded(savePath)
  })

  /** Esc / cancel from any capture window cancels the whole session. */
  ipcMain.on('capture:cancel', () => {
    finishCapture()
  })

  /** Editor asks for the image to edit. */
  ipcMain.handle('editor:get-image', () => editorImagePayload())

  /** Editor: copy a (possibly annotated) PNG to the clipboard. */
  ipcMain.handle('editor:copy-image', (_e, pngBase64: string) => {
    const img = nativeImage.createFromBuffer(Buffer.from(pngBase64, 'base64'))
    if (!img.isEmpty()) clipboard.writeImage(img)
    return true
  })

  /** Editor: save a (possibly annotated) PNG to the Captures folder. */
  ipcMain.handle('editor:save-image', async (_e, pngBase64: string) => {
    const buf = Buffer.from(pngBase64, 'base64')
    const full = await saveScreenshot(buf)
    return full
  })

  /** Editor: "save as" with a file dialog. */
  ipcMain.handle(
    'editor:save-image-as',
    async (_e, pngBase64: string) => {
      const buf = Buffer.from(pngBase64, 'base64')
      const target =
        editorWindow !== null && !editorWindow.isDestroyed()
          ? editorWindow
          : undefined
      const res = await dialog.showSaveDialog(
        target as BrowserWindow,
        {
          title: 'Enregistrer la capture',
          defaultPath: path.join(
            app.getPath('pictures'),
            'PresentOtter',
            'Captures',
            timestampName('png')
          ),
          filters: [
            { name: 'Image PNG', extensions: ['png'] },
            { name: 'Tous fichiers', extensions: ['*'] }
          ]
        }
      )
      if (res.canceled || res.filePath === undefined) return null
      await fsp.writeFile(res.filePath, buf)
      return res.filePath
    }
  )

  /** Editor: reveal a saved file in Explorer. */
  ipcMain.handle('editor:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
