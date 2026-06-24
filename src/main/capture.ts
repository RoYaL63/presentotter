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
  dataUrl: string
  /** Display bounds in DIP (CSS) coordinates. */
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  mode: CaptureMode
  /** True when more than one display is being captured (UI hint). */
  multiDisplay: boolean
  /** desktopCapturer source id of this display (for video getUserMedia). */
  sourceId: string
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
 * Grab a full-resolution still of one display. We issue a getSources call
 * sized to that display's exact device pixels so the returned thumbnail is
 * native resolution (no up/down-scaling). display_id matching is unreliable
 * on Windows, so we fall back to index alignment with getAllDisplays order.
 */
async function grabDisplay(
  display: Display,
  index: number
): Promise<{ dataUrl: string; sourceId: string } | null> {
  const devW = Math.round(display.size.width * display.scaleFactor)
  const devH = Math.round(display.size.height * display.scaleFactor)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: devW, height: devH }
  })
  if (sources.length === 0) return null
  const wanted = String(display.id)
  let match = sources.find(
    (s: Electron.DesktopCapturerSource & { display_id?: string }) =>
      s.display_id === wanted
  )
  if (match === undefined) match = sources[index] ?? sources[0]
  if (match === undefined || match.thumbnail.isEmpty()) return null
  return { dataUrl: match.thumbnail.toDataURL(), sourceId: match.id }
}

function createCaptureWindow(
  display: Display,
  dataUrl: string,
  sourceId: string,
  mode: CaptureMode,
  multiDisplay: boolean
): void {
  if (deps === null) return
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    // Opaque: the window shows the FROZEN frame, so it must not let the
    // live desktop bleed through (which would defeat the freeze).
    transparent: false,
    backgroundColor: '#000000',
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

  frameByWebContents.set(win.webContents.id, {
    dataUrl,
    bounds: { x, y, width, height },
    scaleFactor: display.scaleFactor,
    mode,
    multiDisplay,
    sourceId
  })
  captureWindows.add(win)

  void win.loadURL(deps.rendererUrl('capture'))

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    win.setAlwaysOnTop(true, 'screen-saver')
  })
  win.on('closed', () => {
    frameByWebContents.delete(win.webContents.id)
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

  // Hide our own floating UI so it is not baked into the screenshot.
  pendingRestore = deps.hideOwnUi()
  // Give the compositor a couple of frames to actually remove the windows
  // before we grab the screen. Without this the toolbar/overlay can still
  // appear in the still.
  await delay(180)

  const displays = screen.getAllDisplays()
  const grabbed: Array<{
    display: Display
    dataUrl: string
    sourceId: string
  }> = []
  for (let i = 0; i < displays.length; i++) {
    const d = displays[i]
    if (d === undefined) continue
    try {
      const got = await grabDisplay(d, i)
      if (got !== null) {
        grabbed.push({ display: d, dataUrl: got.dataUrl, sourceId: got.sourceId })
      }
    } catch (err) {
      console.error('[capture] grabDisplay failed:', err)
    }
  }

  if (grabbed.length === 0) {
    // Nothing captured — bail cleanly and restore UI.
    finishCapture()
    return
  }

  const multi = grabbed.length > 1
  for (const g of grabbed) {
    createCaptureWindow(g.display, g.dataUrl, g.sourceId, mode, multi)
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
 * Handle a finished photo selection: copy to clipboard, save to disk,
 * remember it for the editor, restore UI, and notify.
 */
async function handlePhotoSelected(
  pngBase64: string,
  width: number,
  height: number
): Promise<void> {
  const buf = Buffer.from(pngBase64, 'base64')
  finishCapture()

  const img = nativeImage.createFromBuffer(buf)
  if (!img.isEmpty()) clipboard.writeImage(img)

  const savePath = await saveScreenshot(buf)
  lastCapture = { path: savePath, bytes: buf, width, height }
  notifyCaptured(savePath)
  // Dev convenience: open the editor straight away so the full loop is
  // testable without a working OS toast (see CaptureDeps.isDev).
  if (deps?.isDev === true) openEditor()
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
 * Pick a spot for the little recorder control bar that is OUTSIDE the
 * recorded region (so it gets cropped away), preferring just above the
 * region, else just below, clamped to the display work area.
 */
function controlPosition(
  rect: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number
): { x: number; y: number; width: number; height: number } {
  const W = 280
  const H = 52
  const regX = bounds.x + rect.x / scaleFactor
  const regY = bounds.y + rect.y / scaleFactor
  const regW = rect.width / scaleFactor
  const regH = rect.height / scaleFactor
  let x = Math.round(regX + regW / 2 - W / 2)
  x = Math.max(bounds.x + 8, Math.min(bounds.x + bounds.width - W - 8, x))
  let y = Math.round(regY - H - 12)
  if (y < bounds.y + 8) {
    y = Math.round(regY + regH + 12)
    // If still off the bottom (region fills the screen), tuck it inside the
    // bottom edge — rare, and better than an off-screen control.
    y = Math.min(y, bounds.y + bounds.height - H - 8)
  }
  return { x, y, width: W, height: H }
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
  recorderConfigByWebContents.set(win.webContents.id, {
    sourceId,
    rect,
    fps: REGION_FPS
  })
  void win.loadURL(deps.rendererUrl('recorder'))
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => {
    recorderConfigByWebContents.delete(win.webContents.id)
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
        pngBase64: string
        width: number
        height: number
        /** Device-pixel rect on the source display (for video crop). */
        deviceRect?: { x: number; y: number; width: number; height: number }
        bounds?: { x: number; y: number; width: number; height: number }
        scaleFactor?: number
        sourceId?: string
      }
    ) => {
      if (payload.mode === 'video') {
        if (
          payload.deviceRect !== undefined &&
          payload.bounds !== undefined &&
          payload.scaleFactor !== undefined &&
          payload.sourceId !== undefined
        ) {
          startRegionRecording(
            payload.sourceId,
            payload.deviceRect,
            payload.bounds,
            payload.scaleFactor
          )
        } else {
          finishCapture()
        }
        return
      }
      void handlePhotoSelected(payload.pngBase64, payload.width, payload.height)
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
