import { describe, it, expect } from 'vitest'
import { firstValueFrom, take, toArray } from 'rxjs'
import { UIOrchestrator } from '../src/agents/ui/orchestrator'
import { eventBus } from '../event-bus'
import type { CaptureConfig, ExportConfig, ExportFormat, RawRecording } from '../interfaces'

/**
 * UC-03 — Export multi-format
 *
 * Démarre une petite capture puis encode successivement en MP4 / WebM / GIF
 * via le MockFfmpegAdapter injecté par défaut dans l'orchestrator. Valide :
 *   - chaque export résout avec { outputPath, fileSize, duration }
 *   - duration === recording.duration et outputPath matche celui demandé
 *   - events `export:started`, `export:progress` (>=1), `export:complete` émis
 *   - le LibraryManager crée une entry par export:complete (3 entries au total)
 */

const CAPTURE_CONFIG: CaptureConfig = {
  source: 'screen',
  width: 160,
  height: 120,
  fps: 30,
  audioInputs: { system: false, microphone: false }
}

const FORMATS: ExportFormat[] = ['mp4', 'webm', 'gif']

async function captureShortRecording(orch: UIOrchestrator): Promise<RawRecording> {
  await orch.startCapture(CAPTURE_CONFIG)
  await new Promise<void>(resolve => setTimeout(resolve, 120))
  const recording = await orch.stopCapture()
  if (recording === null) throw new Error('Expected a RawRecording')
  return recording
}

describe('UC-03 — Export multi-format', () => {
  it('exports MP4, WebM, and GIF successfully via the mock ffmpeg adapter', async () => {
    const orch = new UIOrchestrator()
    const recording = await captureShortRecording(orch)

    for (const format of FORMATS) {
      const outputPath = `/tmp/output.${format}`
      const config: ExportConfig = {
        format,
        quality: 'medium',
        outputPath
      }
      const result = await orch.exportRecording(recording, config)
      expect(result.outputPath).toBe(outputPath)
      expect(result.duration).toBe(recording.duration)
      expect(typeof result.fileSize).toBe('number')
    }

    orch.dispose()
  })

  it('emits export:started, at least one export:progress, and export:complete for an MP4 export', async () => {
    const orch = new UIOrchestrator()
    const recording = await captureShortRecording(orch)

    const startedPromise = firstValueFrom(eventBus.on('export:started'))
    // On collecte tous les progress émis pendant l'export en se limitant au
    // premier (suffit pour valider qu'au moins un est émis) puis on complète
    // dès qu'on l'a — pas de leak de souscription.
    const progressPromise = firstValueFrom(eventBus.on('export:progress').pipe(take(1)))
    const completePromise = firstValueFrom(eventBus.on('export:complete'))

    const config: ExportConfig = {
      format: 'mp4',
      quality: 'medium',
      outputPath: '/tmp/uc03-events.mp4'
    }

    const result = await orch.exportRecording(recording, config)

    const started = await startedPromise
    expect(started.recordingId).toBe(recording.id)
    expect(started.config.format).toBe('mp4')

    const progress = await progressPromise
    expect(progress.percent).toBeGreaterThanOrEqual(0)
    expect(progress.percent).toBeLessThanOrEqual(100)

    const complete = await completePromise
    expect(complete.outputPath).toBe(result.outputPath)
    expect(complete.duration).toBe(recording.duration)

    orch.dispose()
  })

  it('emits multiple export:progress events during a single encode', async () => {
    const orch = new UIOrchestrator()
    const recording = await captureShortRecording(orch)

    // MockFfmpegAdapter émet 3 progress ticks par défaut. On prend les 2
    // premiers pour rester safe sans timeout possible.
    const progressEventsPromise = firstValueFrom(
      eventBus.on('export:progress').pipe(take(2), toArray())
    )

    const config: ExportConfig = {
      format: 'webm',
      quality: 'medium',
      outputPath: '/tmp/uc03-multi-progress.webm'
    }
    await orch.exportRecording(recording, config)

    const events = await progressEventsPromise
    expect(events.length).toBeGreaterThanOrEqual(2)
    for (const e of events) {
      expect(e.percent).toBeGreaterThanOrEqual(0)
      expect(e.percent).toBeLessThanOrEqual(100)
    }

    orch.dispose()
  })

  it('LibraryManager auto-creates a library entry per successful export', async () => {
    const orch = new UIOrchestrator()
    const recording = await captureShortRecording(orch)

    expect(orch.getLibraryEntries().length).toBe(0)

    for (const format of FORMATS) {
      const config: ExportConfig = {
        format,
        quality: 'medium',
        outputPath: `/tmp/uc03-lib.${format}`
      }
      await orch.exportRecording(recording, config)
    }

    const entries = orch.getLibraryEntries()
    expect(entries.length).toBe(3)

    const formatsInDb = entries.map(e => e.format).sort()
    expect(formatsInDb).toEqual(['gif', 'mp4', 'webm'])

    for (const entry of entries) {
      expect(entry.duration).toBe(recording.duration)
      expect(entry.filePath).toMatch(/^\/tmp\/uc03-lib\.(mp4|webm|gif)$/)
      expect(entry.sanitized).toBe(false)
      expect(entry.tags).toEqual([])
    }

    orch.dispose()
  })
})
