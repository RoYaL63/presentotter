import type { CaptureConfig, CaptureSession, RawRecording } from '@interfaces'
import { PresentOtterError } from '@interfaces'
import { ScreenCapturer } from './capturer'

/**
 * Orchestre une session de capture complète : démarrage, pause/reprise,
 * bookmarks et collecte du RawRecording final. Encapsule le cycle de vie
 * d'un ScreenCapturer pour exposer un CaptureSession conforme à interfaces.ts.
 */
export class CaptureSessionManager {
  private capturer: ScreenCapturer | null = null
  private session: CaptureSession | null = null

  constructor(private readonly config: CaptureConfig) {}

  async start(): Promise<CaptureSession> {
    if (this.session) {
      throw new PresentOtterError(
        'SESSION_ALREADY_ACTIVE',
        'A capture session is already in progress',
        false
      )
    }
    this.capturer = new ScreenCapturer(this.config)
    const sessionId = await this.capturer.start()
    this.session = {
      id: sessionId,
      config: this.config,
      startedAt: new Date(),
      status: 'active',
      annotations: []
    }
    return this.session
  }

  pause(): void {
    this.assertActive('pause')
    this.capturer!.pause()
    this.session!.status = 'paused'
  }

  resume(): void {
    this.assertActive('resume', ['paused'])
    this.capturer!.resume()
    this.session!.status = 'active'
  }

  addBookmark(label?: string): void {
    this.assertActive('bookmark', ['active', 'paused'])
    this.capturer!.addBookmark(label)
  }

  async stop(): Promise<CaptureSession> {
    this.assertActive('stop', ['active', 'paused'])
    const rawRecording: RawRecording = await this.capturer!.stop()
    this.session!.status = 'stopped'
    this.session!.endedAt = new Date()
    this.session!.rawRecording = rawRecording
    const finalSession = this.session!
    this.reset()
    return finalSession
  }

  getSession(): CaptureSession | null {
    return this.session
  }

  // ----- internals -----

  private assertActive(
    action: string,
    allowed: Array<CaptureSession['status']> = ['active']
  ): void {
    if (!this.session || !this.capturer) {
      throw new PresentOtterError(
        'SESSION_NOT_STARTED',
        `Cannot ${action} — no active session`,
        false
      )
    }
    if (!allowed.includes(this.session.status)) {
      throw new PresentOtterError(
        'SESSION_INVALID_STATE',
        `Cannot ${action} from status "${this.session.status}"`,
        false
      )
    }
  }

  private reset(): void {
    this.capturer = null
    this.session = null
  }
}
