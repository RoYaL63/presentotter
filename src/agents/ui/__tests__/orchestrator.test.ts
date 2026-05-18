import { describe, it, expect } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { UIOrchestrator } from '../orchestrator'
import { eventBus } from '../../../../event-bus'
import type { CaptureConfig, ExportConfig } from '../../../../interfaces'

const captureConfig: CaptureConfig = {
  source: 'screen',
  width: 320,
  height: 240,
  fps: 30,
  audioInputs: { system: false, microphone: false }
}

const exportConfig: ExportConfig = {
  format: 'mp4',
  quality: 'medium',
  outputPath: '/tmp/test.mp4'
}

describe('UIOrchestrator', () => {
  it('startCapture returns a CaptureSession and emits capture:started', async () => {
    const orch = new UIOrchestrator()
    const startedPromise = firstValueFrom(eventBus.on('capture:started'))
    const session = await orch.startCapture(captureConfig)
    expect(session.id).toMatch(/^[0-9a-f-]+$/i)
    expect(session.status).toBe('active')
    const event = await startedPromise
    expect(event.sessionId).toBe(session.id)
    await orch.stopCapture()
    orch.dispose()
  })

  it('throws when starting a second capture before stopping the first', async () => {
    const orch = new UIOrchestrator()
    await orch.startCapture(captureConfig)
    await expect(orch.startCapture(captureConfig)).rejects.toThrow()
    await orch.stopCapture()
    orch.dispose()
  })

  it('stopCapture returns the RawRecording and getLastRecording exposes it', async () => {
    const orch = new UIOrchestrator()
    await orch.startCapture(captureConfig)
    await new Promise<void>(resolve => setTimeout(resolve, 80))
    const recording = await orch.stopCapture()
    expect(recording).not.toBeNull()
    expect(recording?.id).toBeTruthy()
    expect(orch.getLastRecording()?.id).toBe(recording?.id)
    orch.dispose()
  })

  it('runSanitizer returns a SanitizeReport', async () => {
    const orch = new UIOrchestrator()
    await orch.startCapture(captureConfig)
    await new Promise<void>(resolve => setTimeout(resolve, 40))
    const recording = await orch.stopCapture()
    if (recording === null) throw new Error('no recording produced')
    const report = await orch.runSanitizer(recording, new Map())
    expect(report.recordingId).toBe(recording.id)
    expect(report.totalFrames).toBe(recording.frames.length)
    orch.dispose()
  })

  it('exportRecording with MockFfmpegAdapter resolves with outputPath', async () => {
    const orch = new UIOrchestrator()
    await orch.startCapture(captureConfig)
    await new Promise<void>(resolve => setTimeout(resolve, 40))
    const recording = await orch.stopCapture()
    if (recording === null) throw new Error('no recording')
    const result = await orch.exportRecording(recording, exportConfig)
    expect(result.outputPath).toBe('/tmp/test.mp4')
    orch.dispose()
  })

  it('renameLibraryEntry emits library:recording-renamed', () => {
    const orch = new UIOrchestrator()
    orch.db.create({
      id: 'rec-1',
      name: 'old name',
      duration: 1000,
      sanitized: false,
      tags: []
    })
    const renamedPromise = firstValueFrom(eventBus.on('library:recording-renamed'))
    orch.renameLibraryEntry('rec-1', 'new name')
    return expect(renamedPromise).resolves.toEqual({
      id: 'rec-1',
      newName: 'new name'
    })
  })

  it('deleteLibraryEntry emits library:recording-deleted', () => {
    const orch = new UIOrchestrator()
    orch.db.create({
      id: 'rec-2',
      name: 'to delete',
      duration: 1000,
      sanitized: false,
      tags: []
    })
    const deletedPromise = firstValueFrom(eventBus.on('library:recording-deleted'))
    orch.deleteLibraryEntry('rec-2')
    return expect(deletedPromise).resolves.toEqual({ id: 'rec-2' })
  })
})
