/**
 * Mock FfmpegAdapter pour les tests.
 *
 * Simule des ticks de progress (3 events par défaut) puis émet `end`, ou
 * peut être configuré pour simuler une erreur après un certain nombre de
 * progress ticks (utile pour tester le chemin `export:error`).
 */

import type {
  FfmpegAdapter,
  FfmpegJob,
  FfmpegOptions,
  FfmpegProgressEvent
} from './ffmpeg-adapter'

export interface MockFfmpegAdapterOptions {
  /** Si true, émet `error` au lieu de `end`. Default false. */
  shouldFail?: boolean
  /** Nombre de progress ticks avant la fin (ou l'erreur). Default 3. */
  failAfterProgress?: number
  /** Message d'erreur custom (si shouldFail). */
  errorMessage?: string
}

export interface MockJobCall {
  input: string | NodeJS.ReadableStream
  outputPath: string
  options: FfmpegOptions
}

export class MockFfmpegAdapter implements FfmpegAdapter {
  /** Historique des appels à createJob — pratique pour les assertions de test. */
  public readonly calls: MockJobCall[] = []
  /** Dernier job créé — pratique pour appeler `.kill()` dans les tests. */
  public lastJob: MockJob | null = null

  constructor(private readonly opts: MockFfmpegAdapterOptions = {}) {}

  createJob(
    input: string | NodeJS.ReadableStream,
    outputPath: string,
    options: FfmpegOptions
  ): FfmpegJob {
    this.calls.push({ input, outputPath, options })
    const job = new MockJob(this.opts)
    this.lastJob = job
    return job
  }
}

export class MockJob implements FfmpegJob {
  private progressHandler: ((e: FfmpegProgressEvent) => void) | null = null
  private endHandler: (() => void) | null = null
  private errorHandler: ((err: Error) => void) | null = null
  private killed = false
  private readonly progressCount: number
  private readonly shouldFail: boolean
  private readonly errorMessage: string

  constructor(opts: MockFfmpegAdapterOptions) {
    this.progressCount = opts.failAfterProgress ?? 3
    this.shouldFail = opts.shouldFail ?? false
    this.errorMessage = opts.errorMessage ?? 'Mock ffmpeg failure'
  }

  onProgress(handler: (e: FfmpegProgressEvent) => void): this {
    this.progressHandler = handler
    return this
  }

  onEnd(handler: () => void): this {
    this.endHandler = handler
    return this
  }

  onError(handler: (err: Error) => void): this {
    this.errorHandler = handler
    return this
  }

  kill(): void {
    this.killed = true
  }

  run(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let tick = 0
      const totalTicks = this.progressCount

      const fireNext = (): void => {
        if (this.killed) {
          // Pas de end ni d'error sur kill — c'est l'encoder qui émet
          // `export:cancelled` via son propre flag.
          resolve()
          return
        }
        if (tick < totalTicks) {
          tick += 1
          const percent = (tick / totalTicks) * 100
          if (this.progressHandler) {
            this.progressHandler({
              frames: tick * 30,
              currentFps: 30,
              currentKbps: 2500,
              targetSize: tick * 1024,
              timemark: `00:00:0${tick}.00`,
              percent
            })
          }
          setImmediate(fireNext)
          return
        }
        if (this.shouldFail) {
          const err = new Error(this.errorMessage)
          if (this.errorHandler) {
            this.errorHandler(err)
          }
          reject(err)
          return
        }
        if (this.endHandler) {
          this.endHandler()
        }
        resolve()
      }

      setImmediate(fireNext)
    })
  }
}
