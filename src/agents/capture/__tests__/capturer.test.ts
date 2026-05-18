import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { firstValueFrom, take, toArray } from 'rxjs'
import { eventBus } from '@event-bus'
import type { CaptureConfig } from '@interfaces'
import { ScreenCapturer } from '../capturer'

const baseConfig: CaptureConfig = {
  source: 'screen',
  width: 16,
  height: 16,
  fps: 30,
  audioInputs: { system: false, microphone: false }
}

describe('ScreenCapturer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits capture:started once with the provided config', async () => {
    const capturer = new ScreenCapturer(baseConfig)
    const started = firstValueFrom(eventBus.on('capture:started').pipe(take(1)))

    const sessionId = await capturer.start()

    const payload = await started
    expect(payload.sessionId).toBe(sessionId)
    expect(payload.config).toEqual(baseConfig)
    expect(typeof payload.timestamp).toBe('number')

    await capturer.stop()
  })

  it('emits ~3 capture:frame events after 100ms at 30fps', async () => {
    const capturer = new ScreenCapturer(baseConfig)
    const framesPromise = firstValueFrom(
      eventBus.on('capture:frame').pipe(take(3), toArray())
    )

    await capturer.start()
    await vi.advanceTimersByTimeAsync(120)

    const frames = await framesPromise
    expect(frames.length).toBe(3)
    expect(frames[0].frameIndex).toBe(0)
    expect(frames[1].frameIndex).toBe(1)
    expect(frames[2].frameIndex).toBe(2)
    expect(frames[0].frame.data.length).toBe(16 * 16 * 4)
    expect(frames[0].frame.format).toBe('rgba')

    await capturer.stop()
  })

  it('pause stops emitting frames and resume restarts them', async () => {
    const capturer = new ScreenCapturer(baseConfig)
    let frameCount = 0
    const sub = eventBus.on('capture:frame').subscribe(() => {
      frameCount += 1
    })

    await capturer.start()
    await vi.advanceTimersByTimeAsync(100)
    const countAfterStart = frameCount
    expect(countAfterStart).toBeGreaterThan(0)

    capturer.pause()
    await vi.advanceTimersByTimeAsync(200)
    expect(frameCount).toBe(countAfterStart)

    capturer.resume()
    await vi.advanceTimersByTimeAsync(100)
    expect(frameCount).toBeGreaterThan(countAfterStart)

    sub.unsubscribe()
    await capturer.stop()
  })

  it('stop emits capture:stopped with a valid RawRecording', async () => {
    const capturer = new ScreenCapturer(baseConfig)
    const stopped = firstValueFrom(eventBus.on('capture:stopped').pipe(take(1)))

    const sessionId = await capturer.start()
    await vi.advanceTimersByTimeAsync(150)
    const recording = await capturer.stop()

    const payload = await stopped
    expect(payload.sessionId).toBe(sessionId)
    expect(payload.rawRecording.id).toBe(sessionId)
    expect(payload.rawRecording.frames.length).toBeGreaterThan(0)
    expect(payload.rawRecording.duration).toBeGreaterThan(0)
    expect(recording.config).toEqual(baseConfig)
    expect(recording.audioData).toBeInstanceOf(Buffer)
    expect(recording.bookmarks).toEqual([])
  })

  it('addBookmark emits capture:bookmark with the right frameIndex', async () => {
    const capturer = new ScreenCapturer(baseConfig)
    const bookmark = firstValueFrom(
      eventBus.on('capture:bookmark').pipe(take(1))
    )

    await capturer.start()
    await vi.advanceTimersByTimeAsync(70)
    capturer.addBookmark('checkpoint')

    const payload = await bookmark
    expect(payload.label).toBe('checkpoint')
    expect(payload.frameIndex).toBeGreaterThanOrEqual(0)
    expect(typeof payload.timestamp).toBe('number')

    await capturer.stop()
  })
})
