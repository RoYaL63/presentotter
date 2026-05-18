import { describe, it, expect } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { UIOrchestrator } from '../src/agents/ui/orchestrator'
import { eventBus } from '../event-bus'
import type { CaptureConfig } from '../interfaces'

/**
 * UC-01 — Capture simple
 *
 * Démarre une capture mock (320x240, 30fps, system audio), attend que le
 * ticker du ScreenCapturer émette quelques frames, puis stop et valide :
 *   - la CaptureSession initiale est correcte
 *   - le RawRecording retourné contient frames + duration > 0
 *   - les Buffers de frame ont la bonne taille RGBA
 *   - les events `capture:started` / `capture:stopped` sont émis
 *   - les bookmarks ajoutés en cours de capture sont conservés
 */

const CAPTURE_CONFIG: CaptureConfig = {
  source: 'screen',
  width: 320,
  height: 240,
  fps: 30,
  audioInputs: { system: true, microphone: false }
}

describe('UC-01 — Capture simple', () => {
  it('startCapture returns an active session with a non-empty id and emits capture:started', async () => {
    const orch = new UIOrchestrator()
    const startedPromise = firstValueFrom(eventBus.on('capture:started'))

    const session = await orch.startCapture(CAPTURE_CONFIG)

    expect(session.id).toBeTruthy()
    expect(session.id.length).toBeGreaterThan(0)
    expect(session.status).toBe('active')
    expect(session.config).toEqual(CAPTURE_CONFIG)

    const event = await startedPromise
    expect(event.sessionId).toBe(session.id)
    expect(event.config).toEqual(CAPTURE_CONFIG)

    await orch.stopCapture()
    orch.dispose()
  })

  it('stopCapture returns a RawRecording with frames, audio, and a positive duration', async () => {
    const orch = new UIOrchestrator()
    const stoppedPromise = firstValueFrom(eventBus.on('capture:stopped'))

    const session = await orch.startCapture(CAPTURE_CONFIG)
    // ~150ms à 30fps = environ 4-5 frames mock
    await new Promise<void>(resolve => setTimeout(resolve, 150))
    const recording = await orch.stopCapture()

    expect(recording).not.toBeNull()
    if (recording === null) throw new Error('recording is null')

    expect(recording.id).toBe(session.id)
    expect(recording.frames.length).toBeGreaterThanOrEqual(3)

    const firstFrame = recording.frames[0]
    expect(firstFrame).toBeDefined()
    if (!firstFrame) throw new Error('first frame is undefined')
    expect(firstFrame.width).toBe(CAPTURE_CONFIG.width)
    expect(firstFrame.height).toBe(CAPTURE_CONFIG.height)
    expect(firstFrame.format).toBe('rgba')
    expect(firstFrame.data).toBeInstanceOf(Buffer)
    expect(firstFrame.data.length).toBe(
      CAPTURE_CONFIG.width * CAPTURE_CONFIG.height * 4
    )

    expect(recording.duration).toBeGreaterThan(0)
    expect(recording.config).toEqual(CAPTURE_CONFIG)
    expect(recording.audioData).toBeInstanceOf(Buffer)
    expect(recording.createdAt).toBeInstanceOf(Date)

    const stopEvent = await stoppedPromise
    expect(stopEvent.sessionId).toBe(session.id)
    expect(stopEvent.rawRecording.id).toBe(recording.id)
    expect(stopEvent.rawRecording.frames.length).toBe(recording.frames.length)

    orch.dispose()
  })

  it('addBookmark during capture is included in the final RawRecording', async () => {
    const orch = new UIOrchestrator()
    await orch.startCapture(CAPTURE_CONFIG)
    await new Promise<void>(resolve => setTimeout(resolve, 60))
    orch.addBookmark('first-bookmark')
    await new Promise<void>(resolve => setTimeout(resolve, 60))
    orch.addBookmark()

    const recording = await orch.stopCapture()
    expect(recording).not.toBeNull()
    if (recording === null) throw new Error('recording is null')

    expect(recording.bookmarks.length).toBe(2)
    const labels = recording.bookmarks.map(b => b.label)
    expect(labels).toContain('first-bookmark')

    orch.dispose()
  })

  it('getLastRecording exposes the most recent stop result', async () => {
    const orch = new UIOrchestrator()
    expect(orch.getLastRecording()).toBeNull()

    await orch.startCapture(CAPTURE_CONFIG)
    await new Promise<void>(resolve => setTimeout(resolve, 60))
    const recording = await orch.stopCapture()

    expect(recording).not.toBeNull()
    expect(orch.getLastRecording()?.id).toBe(recording?.id)

    orch.dispose()
  })
})
