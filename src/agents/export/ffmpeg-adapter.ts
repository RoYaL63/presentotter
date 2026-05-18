/**
 * FFmpeg adapter — abstrait fluent-ffmpeg derrière une interface minimale.
 *
 * Pourquoi : fluent-ffmpeg s'appuie sur le binaire FFmpeg externe (et est un
 * module nœud lourd qui peut ne pas être présent en sandbox de test). On
 * injecte donc l'adapter dans `VideoEncoder` et on utilise `MockFfmpegAdapter`
 * pour les tests, `createFluentFfmpegAdapter` en production runtime.
 *
 * Le require est dynamique pour éviter que fluent-ffmpeg soit résolu au
 * moment du parse — il ne sera chargé qu'à l'appel de la factory.
 */

export interface FfmpegProgressEvent {
  frames: number
  currentFps: number
  currentKbps: number
  targetSize: number
  /** Format "HH:MM:SS.mm" tel que renvoyé par fluent-ffmpeg. */
  timemark: string
  /** Pourcent (0-100) — pas toujours fourni par fluent-ffmpeg. */
  percent?: number
}

export interface FfmpegJob {
  onProgress(handler: (e: FfmpegProgressEvent) => void): this
  onEnd(handler: () => void): this
  onError(handler: (err: Error) => void): this
  /** Tue le job FFmpeg en cours (SIGKILL). */
  kill(): void
  /** Lance l'encodage. La promesse résout à la fin ou rejette sur erreur. */
  run(): Promise<void>
}

export interface FfmpegOptions {
  videoCodec?: string
  audioCodec?: string
  videoBitrate?: string
  audioBitrate?: string
  /** ex "1920x1080" — sera passé à `-s`. */
  size?: string
  fps?: number
  /** ex "mp4", "webm", "gif". */
  format?: string
  /** Arguments bruts FFmpeg additionnels, ex pour `-vf` watermark. */
  extraArgs?: string[]
}

export interface FfmpegAdapter {
  createJob(
    input: string | NodeJS.ReadableStream,
    outputPath: string,
    options: FfmpegOptions
  ): FfmpegJob
}

/**
 * Type minimal du chaînage fluent-ffmpeg dont on a besoin.
 * Évite la dépendance type sur le package au compile-time.
 */
interface FluentFfmpegCommand {
  videoCodec(codec: string): FluentFfmpegCommand
  audioCodec(codec: string): FluentFfmpegCommand
  videoBitrate(bitrate: string): FluentFfmpegCommand
  audioBitrate(bitrate: string): FluentFfmpegCommand
  size(size: string): FluentFfmpegCommand
  fps(fps: number): FluentFfmpegCommand
  format(fmt: string): FluentFfmpegCommand
  outputOptions(args: string[]): FluentFfmpegCommand
  output(path: string): FluentFfmpegCommand
  on(event: 'progress', handler: (e: FfmpegProgressEvent) => void): FluentFfmpegCommand
  on(event: 'end', handler: () => void): FluentFfmpegCommand
  on(event: 'error', handler: (err: Error) => void): FluentFfmpegCommand
  kill(signal: string): void
  run(): void
}

interface FluentFfmpegModule {
  (input: string | NodeJS.ReadableStream): FluentFfmpegCommand
  setFfmpegPath(path: string): void
}

/**
 * Factory fluent-ffmpeg (runtime uniquement, jamais utilisé en test).
 *
 * @param ffmpegPath Chemin optionnel vers le binaire FFmpeg (default : binaire
 *   trouvé dans le PATH ou via ffmpeg-static).
 */
export function createFluentFfmpegAdapter(ffmpegPath?: string): FfmpegAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpeg = require('fluent-ffmpeg') as FluentFfmpegModule
  if (ffmpegPath !== undefined) {
    ffmpeg.setFfmpegPath(ffmpegPath)
  }

  return {
    createJob(
      input: string | NodeJS.ReadableStream,
      outputPath: string,
      options: FfmpegOptions
    ): FfmpegJob {
      let command = ffmpeg(input)

      if (options.videoCodec !== undefined) {
        command = command.videoCodec(options.videoCodec)
      }
      if (options.audioCodec !== undefined) {
        command = command.audioCodec(options.audioCodec)
      }
      if (options.videoBitrate !== undefined) {
        command = command.videoBitrate(options.videoBitrate)
      }
      if (options.audioBitrate !== undefined) {
        command = command.audioBitrate(options.audioBitrate)
      }
      if (options.size !== undefined) {
        command = command.size(options.size)
      }
      if (options.fps !== undefined) {
        command = command.fps(options.fps)
      }
      if (options.format !== undefined) {
        command = command.format(options.format)
      }
      if (options.extraArgs !== undefined && options.extraArgs.length > 0) {
        command = command.outputOptions(options.extraArgs)
      }
      command = command.output(outputPath)

      const job: FfmpegJob = {
        onProgress(handler) {
          command.on('progress', handler)
          return this
        },
        onEnd(handler) {
          command.on('end', handler)
          return this
        },
        onError(handler) {
          command.on('error', handler)
          return this
        },
        kill() {
          command.kill('SIGKILL')
        },
        run() {
          return new Promise<void>((resolve, reject) => {
            command.on('end', () => resolve())
            command.on('error', (err: Error) => reject(err))
            command.run()
          })
        }
      }
      return job
    }
  }
}
