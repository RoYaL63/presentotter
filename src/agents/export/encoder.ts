import { eventBus } from '../../../event-bus'
import type {
  ExportConfig,
  ExportFormat,
  RawRecording,
  SanitizedRecording
} from '../../../interfaces'
import type {
  FfmpegAdapter,
  FfmpegJob,
  FfmpegOptions,
  FfmpegProgressEvent
} from './ffmpeg-adapter'
import { getPresetForFormat } from './presets'

export type FileStatProvider = (path: string) => number

export interface VideoEncoderDeps {
  adapter: FfmpegAdapter
  /** Optionnel : retourne la taille du fichier produit. Default : 0. */
  fileStatProvider?: FileStatProvider
}

interface ActiveJob {
  recordingId: string
  job: FfmpegJob
  cancelled: boolean
}

/**
 * Encode un RawRecording / SanitizedRecording vers un fichier MP4/WebM/GIF.
 *
 * - Émet `export:started`, `export:progress` (~à chaque tick), `export:complete`
 *   ou `export:error` selon le déroulement.
 * - Supporte l'annulation via `cancel(recordingId)` qui kill le job FFmpeg
 *   en cours et émet `export:cancelled`.
 */
export class VideoEncoder {
  private active: ActiveJob | null = null

  constructor(private readonly deps: VideoEncoderDeps) {}

  async encode(
    recording: RawRecording | SanitizedRecording,
    config: ExportConfig
  ): Promise<{ outputPath: string; fileSize: number; duration: number }> {
    eventBus.emit('export:started', { recordingId: recording.id, config })

    const preset = config.preset ?? getPresetForFormat(config.format, config.quality)
    const options = buildOptionsForFormat(config.format, preset)
    const totalFrames = recording.frames.length

    // Pour P0 : on passe le chemin d'entrée comme empty string. La vraie
    // intégration de Vitrine fera framesToRawVideoPipe(recording).
    const job = this.deps.adapter.createJob('', config.outputPath, options)
    this.active = { recordingId: recording.id, job, cancelled: false }

    return new Promise<{ outputPath: string; fileSize: number; duration: number }>(
      (resolve, reject) => {
        job.onProgress((e: FfmpegProgressEvent) => {
          if (this.active?.cancelled === true) return
          const percent = e.percent ?? estimatePercent(e.frames, totalFrames)
          const eta = estimateEta(percent, e.currentFps, totalFrames, e.frames)
          eventBus.emit('export:progress', {
            percent,
            eta,
            currentFrame: e.frames
          })
        })

        job.onEnd(() => {
          if (this.active?.cancelled === true) {
            this.active = null
            return
          }
          const fileSize =
            this.deps.fileStatProvider?.(config.outputPath) ?? 0
          const result = {
            outputPath: config.outputPath,
            fileSize,
            duration: recording.duration
          }
          eventBus.emit('export:complete', result)
          this.active = null
          resolve(result)
        })

        job.onError((err: Error) => {
          if (this.active?.cancelled === true) {
            this.active = null
            return
          }
          eventBus.emit('export:error', {
            code: 'FFMPEG_ERROR',
            message: err.message
          })
          this.active = null
          reject(err)
        })

        job.run().catch((err: Error) => {
          // run() rejette déjà sur error, mais on couvre le cas où aucun
          // handler n'a été appelé.
          if (this.active?.cancelled !== true) {
            eventBus.emit('export:error', {
              code: 'FFMPEG_RUN_FAILED',
              message: err.message
            })
            reject(err)
          }
          this.active = null
        })
      }
    )
  }

  cancel(recordingId: string): void {
    if (this.active === null || this.active.recordingId !== recordingId) return
    this.active.cancelled = true
    this.active.job.kill()
    eventBus.emit('export:cancelled', { recordingId })
    this.active = null
  }
}

/**
 * Construit les FfmpegOptions adaptés au format de sortie.
 *
 * Les codecs audio sont omis pour GIF (pas d'audio dans GIF).
 */
function buildOptionsForFormat(
  format: ExportFormat,
  preset: { codec: string; bitrate: string; scale?: string; fps?: number }
): FfmpegOptions {
  const opts: FfmpegOptions = {
    videoCodec: preset.codec,
    format
  }
  if (preset.bitrate !== 'n/a' && !preset.bitrate.startsWith('crf=')) {
    opts.videoBitrate = preset.bitrate
  }
  if (preset.bitrate.startsWith('crf=')) {
    opts.extraArgs = ['-crf', preset.bitrate.slice(4)]
  }
  if (preset.scale !== undefined) {
    opts.size = preset.scale
  }
  if (preset.fps !== undefined) {
    opts.fps = preset.fps
  }
  if (format !== 'gif') {
    opts.audioCodec = format === 'webm' ? 'libopus' : 'aac'
    opts.audioBitrate = '128k'
  }
  return opts
}

function estimatePercent(currentFrame: number, totalFrames: number): number {
  if (totalFrames <= 0) return 0
  return Math.min(100, (currentFrame / totalFrames) * 100)
}

function estimateEta(
  percent: number,
  currentFps: number,
  totalFrames: number,
  currentFrame: number
): number {
  if (currentFps <= 0 || percent >= 100) return 0
  const remainingFrames = Math.max(0, totalFrames - currentFrame)
  return Math.round(remainingFrames / currentFps)
}
