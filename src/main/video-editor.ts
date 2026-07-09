import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  buildFfmpegArgs,
  clampVolume,
  effectiveFade,
  sanitizeSegments,
  sanitizeZones,
  willReencode,
  type VideoEditRequest
} from './ffmpeg-args'

/**
 * Post-production editor (phase 1: trim + speed + crop).
 *
 * A saved recording is opened in a dedicated window. The renderer loads the
 * file as a Blob (bytes handed over IPC so there's no file:// / webSecurity
 * dance across dev vs prod), lets the user pick an in/out range, a playback
 * speed and an optional crop rectangle, then asks main to render the result
 * with ffmpeg.
 *
 * ffmpeg is NOT bundled (see updater notes / recording:export-mp4). The user
 * installs it once (winget install Gyan.FFmpeg). We locate it via the shared
 * `locateFfmpeg` dependency and surface a clear 'ffmpeg-missing' result when
 * it's absent, so the UI can point the user at the install command.
 */

export interface VideoEditorDeps {
  rendererUrl: (hash: 'video-editor') => string
  preloadPath: string
  /** Resolve the ffmpeg.exe path, or null when it isn't installed. */
  locateFfmpeg: () => string | null
}

let deps: VideoEditorDeps | null = null
let editorWindow: BrowserWindow | null = null
/** Path of the file currently loaded in the editor window. */
let currentInputPath: string | null = null

function createEditorWindow(): BrowserWindow {
  if (deps === null) throw new Error('video-editor deps not registered')
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    title: 'PresentOtter — Éditeur vidéo',
    backgroundColor: '#07212F',
    show: false,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  void win.loadURL(deps.rendererUrl('video-editor'))
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    editorWindow = null
    currentInputPath = null
  })
  return win
}

/** Open the editor on a given file (or focus + reload if already open). */
export function openVideoEditor(inputPath: string): void {
  if (deps === null) return
  currentInputPath = inputPath
  if (editorWindow !== null && !editorWindow.isDestroyed()) {
    editorWindow.focus()
    editorWindow.webContents.send('video-editor:load', { path: inputPath })
    return
  }
  editorWindow = createEditorWindow()
}

/** Where edited videos are written. Sibling "Edits" folder under Videos. */
async function editsDir(): Promise<string> {
  const dir = path.join(app.getPath('videos'), 'PresentOtter', 'Edits')
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

function sanitizeName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 180)
  return cleaned.length > 0 ? cleaned : `montage-${Date.now()}`
}

/** Parse ffmpeg's "time=HH:MM:SS.xx" progress line into seconds. */
function parseFfmpegTime(line: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line)
  if (m === null) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  const s = Number(m[3])
  if (!Number.isFinite(h) || !Number.isFinite(mi) || !Number.isFinite(s)) return null
  return h * 3600 + mi * 60 + s
}

/**
 * Ask ffmpeg to dump the input's stream info (no output → it exits with an
 * error after listing the streams on stderr). We only need to know whether an
 * audio stream exists, so the multi-segment concat graph can skip [0:a] on a
 * soundless recording instead of failing.
 */
async function detectHasAudio(ffmpeg: string, inputPath: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-i', inputPath], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    proc.on('error', () => resolve(false))
    proc.on('exit', () => resolve(/Stream #\d+:\d+.*: Audio:/.test(stderr)))
  })
}

/** On-video text sent by the renderer: a pre-rasterized full-frame
 *  transparent PNG (dataURL) + its source-time window. */
interface TextPayload {
  dataUrl: string
  start: number
  end: number
}

/** What the editor window actually sends over IPC — overlays arrive as
 *  dataURLs and are materialized into temp PNG files here. */
type EditorExportRequest = Omit<VideoEditRequest, 'overlays'> & {
  texts: TextPayload[]
}

/** Write the rasterized texts to temp PNGs ffmpeg can read. Returns the
 *  overlay descriptors + a cleanup callback. */
async function materializeTexts(
  texts: TextPayload[]
): Promise<{ overlays: Array<{ path: string; start: number; end: number }>; cleanup: () => void }> {
  const dir = path.join(app.getPath('temp'), 'presentotter-edit')
  await fsp.mkdir(dir, { recursive: true })
  const overlays: Array<{ path: string; start: number; end: number }> = []
  const stamp = Date.now()
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]
    if (t === undefined) continue
    const base64 = t.dataUrl.split(',')[1]
    if (base64 === undefined || base64.length === 0) continue
    const file = path.join(dir, `text-${stamp}-${i}.png`)
    await fsp.writeFile(file, Buffer.from(base64, 'base64'))
    overlays.push({ path: file, start: t.start, end: t.end })
  }
  return {
    overlays,
    cleanup: () => {
      for (const o of overlays) {
        void fsp.unlink(o.path).catch(() => {})
      }
    }
  }
}

async function runExport(
  event: IpcMainInvokeEvent,
  ipcReq: EditorExportRequest
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (deps === null) return { ok: false, reason: 'not-ready' }
  const ffmpeg = deps.locateFfmpeg()
  if (ffmpeg === null) return { ok: false, reason: 'ffmpeg-missing' }

  let inputExists = true
  try {
    await fsp.access(ipcReq.inputPath)
  } catch {
    inputExists = false
  }
  if (!inputExists) return { ok: false, reason: 'input-missing' }

  const { overlays, cleanup } = await materializeTexts(ipcReq.texts ?? [])
  const req: VideoEditRequest = { ...ipcReq, overlays }

  const segs = sanitizeSegments(req.segments)
  const volume = clampVolume(req.volume)
  const zones = sanitizeZones(req.volumeZones)
  // The join graph and the volume filters all reference [0:a]; probe the
  // input first so a soundless recording doesn't fail on a missing stream.
  const needsAudioProbe = segs.length > 1 || volume !== 1 || zones.length > 0
  const hasAudio = needsAudioProbe ? await detectHasAudio(ffmpeg, req.inputPath) : true

  const dir = await editsDir()
  // A re-encode (concat / crop / speed) is H.264 → must be .mp4. A trim-only
  // `-c copy` keeps the source container so it stays lossless + instant.
  const sourceExt = path.extname(req.inputPath).replace('.', '') || 'mp4'
  const ext = willReencode(req) ? 'mp4' : sourceExt
  const outputPath = path.join(dir, `${sanitizeName(req.outputName)}.${ext}`)
  const args = buildFfmpegArgs(req, outputPath, hasAudio)

  // Expected output duration drives the progress ratio: total kept time,
  // minus what each crossfade absorbs (one fadeDur per joint), over speed.
  const speed = req.speed > 0 ? req.speed : 1
  const fade = effectiveFade(segs, req.transition?.duration ?? 0)
  const keptDuration =
    segs.reduce((sum, s) => sum + (s.end - s.start), 0) -
    fade * Math.max(0, segs.length - 1)
  const outDuration = keptDuration > 0 ? keptDuration / speed : 0

  return await new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true })
    let stderrTail = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrTail = (stderrTail + text).slice(-4000)
      const t = parseFfmpegTime(text)
      if (t !== null && outDuration > 0 && !event.sender.isDestroyed()) {
        event.sender.send('video-editor:progress', {
          ratio: Math.max(0, Math.min(1, t / outDuration))
        })
      }
    })
    proc.on('error', (err) => {
      cleanup()
      resolve({ ok: false, reason: `ffmpeg-error: ${err.message}` })
    })
    proc.on('exit', (code) => {
      cleanup()
      if (code === 0) {
        resolve({ ok: true, path: outputPath })
        return
      }
      // Surface the MEANINGFUL stderr lines, not the generic trailing
      // "Conversion failed!" — that one buried the real cause ("width not
      // divisible by 2") for days. Full tail + args go to the console.
      console.error('[video-editor] ffmpeg failed', { args, stderrTail })
      const meaningful = stderrTail
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            /error|invalid|failed|denied|not divisible|no such|unable|unsupported|does not|cannot/i.test(l) &&
            l !== 'Conversion failed!'
        )
      const reason = meaningful.slice(-2).join(' · ')
      resolve({
        ok: false,
        reason:
          reason.length > 0
            ? reason.slice(0, 300)
            : `ffmpeg-exit-${code ?? 'null'}: ${stderrTail.trim().split('\n').pop() ?? ''}`
      })
    })
  })
}

export function registerVideoEditorIpc(d: VideoEditorDeps): void {
  deps = d

  /** Home / notification / library trigger: open the editor on a file. */
  ipcMain.on('video-editor:open', (_e, filePath: string) => {
    if (typeof filePath === 'string' && filePath.length > 0) {
      openVideoEditor(filePath)
    }
  })

  /** The editor window asks for its input file: just the path + name. The
   *  renderer streams the pixels via the `po-media://` protocol (see main.ts)
   *  rather than copying the whole file over IPC, so opening is instant even
   *  for a multi-hundred-MB recording. */
  ipcMain.handle('video-editor:get-input', () => {
    if (currentInputPath === null) return null
    return {
      path: currentInputPath,
      name: path.basename(currentInputPath)
    }
  })

  /** Render the edit with ffmpeg. */
  ipcMain.handle('video-editor:export', (event, req: EditorExportRequest) =>
    runExport(event, req)
  )

  /** Reveal an exported file in Explorer. */
  ipcMain.handle('video-editor:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  /** Let the user pick a different video to edit (Open… entry point). */
  ipcMain.handle('video-editor:pick-file', async () => {
    const target =
      editorWindow !== null && !editorWindow.isDestroyed() ? editorWindow : undefined
    const res = await dialog.showOpenDialog(target as BrowserWindow, {
      title: 'Ouvrir une vidéo à éditer',
      defaultPath: path.join(app.getPath('videos'), 'PresentOtter'),
      properties: ['openFile'],
      filters: [
        { name: 'Vidéos', extensions: ['mp4', 'webm', 'mov', 'mkv'] },
        { name: 'Tous fichiers', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths[0] === undefined) return null
    currentInputPath = res.filePaths[0]
    return { path: currentInputPath, name: path.basename(currentInputPath) }
  })
}
