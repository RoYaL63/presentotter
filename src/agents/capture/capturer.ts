import { eventBus } from '@event-bus'
import type { CaptureConfig, VideoFrame, RawRecording } from '@interfaces'
import { PresentOtterError } from '@interfaces'
import { AudioCapturer } from './audio'
import { BookmarkTracker } from './bookmarks'

/**
 * P0 — Mock capturer. La Phase 3 branchera Windows Graphics Capture API
 * via une addon native (ex: node-screen-capture / electron desktopCapturer).
 */
export const IS_MOCK = true

type CapturerStatus = 'idle' | 'active' | 'paused' | 'stopped'

export class ScreenCapturer {
  private sessionId: string | null = null
  private status: CapturerStatus = 'idle'
  private startedAt = 0
  private pausedAt = 0
  private pausedDurationMs = 0
  private frames: VideoFrame[] = []
  private bookmarks = new BookmarkTracker()
  private audio = new AudioCapturer({
    system: this.config.audioInputs.system,
    microphone: this.config.audioInputs.microphone
  })
  private tickHandle: ReturnType<typeof setInterval> | null = null
  private frameIndex = 0

  constructor(private readonly config: CaptureConfig) {}

  async start(): Promise<string> {
    if (this.status !== 'idle') {
      throw new PresentOtterError(
        'CAPTURE_ALREADY_STARTED',
        `Cannot start capture in status "${this.status}"`,
        false
      )
    }

    this.sessionId = this.generateSessionId()
    this.startedAt = Date.now()
    this.pausedDurationMs = 0
    this.frames = []
    this.frameIndex = 0
    this.status = 'active'

    await this.audio.start()
    this.startTicker()

    eventBus.emit('capture:started', {
      sessionId: this.sessionId,
      config: this.config,
      timestamp: this.startedAt
    })

    return this.sessionId
  }

  pause(): void {
    if (this.status !== 'active' || !this.sessionId) return
    this.status = 'paused'
    this.pausedAt = Date.now()
    this.stopTicker()
    this.audio.pause()

    eventBus.emit('capture:paused', {
      sessionId: this.sessionId,
      elapsed: this.computeElapsed()
    })
  }

  resume(): void {
    if (this.status !== 'paused' || !this.sessionId) return
    this.pausedDurationMs += Date.now() - this.pausedAt
    this.pausedAt = 0
    this.status = 'active'
    this.audio.resume()
    this.startTicker()

    eventBus.emit('capture:resumed', { sessionId: this.sessionId })
  }

  async stop(): Promise<RawRecording> {
    if (this.status === 'idle' || !this.sessionId) {
      throw new PresentOtterError(
        'CAPTURE_NOT_STARTED',
        'Cannot stop a capture that has not started',
        false
      )
    }

    this.stopTicker()
    if (this.status === 'paused') {
      this.pausedDurationMs += Date.now() - this.pausedAt
      this.pausedAt = 0
    }
    this.status = 'stopped'

    const audioData = await this.audio.stop()
    const duration = this.computeElapsed()

    const recording: RawRecording = {
      id: this.sessionId,
      frames: this.frames,
      audioData,
      duration,
      config: this.config,
      bookmarks: this.bookmarks.getAll(),
      createdAt: new Date(this.startedAt)
    }

    eventBus.emit('capture:stopped', {
      sessionId: this.sessionId,
      rawRecording: recording
    })

    return recording
  }

  addBookmark(label?: string): void {
    if (!this.sessionId) return
    const timestamp = this.computeElapsed()
    this.bookmarks.add(this.frameIndex, label)
    const payload: { frameIndex: number; timestamp: number; label?: string } =
      label === undefined
        ? { frameIndex: this.frameIndex, timestamp }
        : { frameIndex: this.frameIndex, timestamp, label }
    eventBus.emit('capture:bookmark', payload)
  }

  // ----- internals -----

  private startTicker(): void {
    if (this.tickHandle) return
    const intervalMs = Math.max(1, Math.round(1000 / this.config.fps))
    this.tickHandle = setInterval(() => this.tick(), intervalMs)
  }

  private stopTicker(): void {
    if (!this.tickHandle) return
    clearInterval(this.tickHandle)
    this.tickHandle = null
  }

  private tick(): void {
    if (this.status !== 'active') return
    const frame = this.buildMockFrame()
    this.frames.push(frame)
    eventBus.emit('capture:frame', {
      frame,
      timestamp: frame.timestamp,
      frameIndex: this.frameIndex
    })
    this.frameIndex += 1
  }

  private buildMockFrame(): VideoFrame {
    // RGBA = 4 octets / pixel. Buffer zéroé pour le mock P0.
    const size = this.config.width * this.config.height * 4
    return {
      data: Buffer.alloc(size),
      width: this.config.width,
      height: this.config.height,
      timestamp: this.computeElapsed(),
      format: 'rgba'
    }
  }

  private computeElapsed(): number {
    if (this.startedAt === 0) return 0
    const ref = this.status === 'paused' ? this.pausedAt : Date.now()
    return Math.max(0, ref - this.startedAt - this.pausedDurationMs)
  }

  private generateSessionId(): string {
    // crypto.randomUUID dispo en Node >= 14.17
    return globalThis.crypto.randomUUID()
  }
}
