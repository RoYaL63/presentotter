import { describe, it, expect } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { UIOrchestrator } from '../src/agents/ui/orchestrator'
import { eventBus } from '../event-bus'
import type { CaptureConfig, RawRecording } from '../interfaces'

/**
 * UC-02 — Sanitizer détecte les secrets
 *
 * Démarre une petite capture, fournit un Map<frameIndex, text> avec une
 * OpenAI key dans la frame 1 et un JWT dans la frame 2. Valide :
 *   - SanitizeReport non vide
 *   - zonesDetected contient au moins une zone api-key (OpenAI) et une zone jwt
 *   - totalFrames === recording.frames.length
 *   - event `sanitizer:analysis-complete` émis
 *   - Map vide => zonesDetected.length === 0
 */

const CAPTURE_CONFIG: CaptureConfig = {
  source: 'screen',
  width: 160,
  height: 120,
  fps: 30,
  audioInputs: { system: false, microphone: false }
}

const OPENAI_KEY_LINE =
  "const key = 'sk-1234567890abcdef1234567890'"
const JWT_LINE =
  'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

async function captureShortRecording(orch: UIOrchestrator): Promise<RawRecording> {
  await orch.startCapture(CAPTURE_CONFIG)
  await new Promise<void>(resolve => setTimeout(resolve, 250))
  const recording = await orch.stopCapture()
  if (recording === null) {
    throw new Error('Expected a RawRecording from stopCapture')
  }
  // Sanity check : on a besoin d'au moins 3 frames pour pouvoir indexer
  // les textes sur frames 1 et 2.
  expect(recording.frames.length).toBeGreaterThanOrEqual(3)
  return recording
}

describe('UC-02 — Sanitizer détecte les secrets', () => {
  it('detects an OpenAI api-key and a JWT across two frames', async () => {
    const orch = new UIOrchestrator()
    const recording = await captureShortRecording(orch)

    const completePromise = firstValueFrom(
      eventBus.on('sanitizer:analysis-complete')
    )

    const textPerFrame = new Map<number, string>([
      [1, OPENAI_KEY_LINE],
      [2, JWT_LINE]
    ])

    const report = await orch.runSanitizer(recording, textPerFrame)

    expect(report.recordingId).toBe(recording.id)
    expect(report.totalFrames).toBe(recording.frames.length)
    expect(report.zonesDetected.length).toBeGreaterThanOrEqual(2)

    const openaiZone = report.zonesDetected.find(
      z => z.type === 'api-key' && z.pattern === 'sk-prefixed-key'
    )
    expect(openaiZone).toBeDefined()
    expect(openaiZone?.frameIndices).toContain(1)

    const jwtZone = report.zonesDetected.find(
      z => z.type === 'jwt' || z.pattern.toLowerCase().includes('jwt')
    )
    expect(jwtZone).toBeDefined()
    expect(jwtZone?.frameIndices).toContain(2)

    const completeEvent = await completePromise
    expect(completeEvent.report.recordingId).toBe(recording.id)
    expect(completeEvent.detectedZones.length).toBeGreaterThanOrEqual(2)

    orch.dispose()
  })

  it('returns an empty zonesDetected list when no text contains secrets', async () => {
    const orch = new UIOrchestrator()
    const recording = await captureShortRecording(orch)

    const report = await orch.runSanitizer(recording, new Map())

    expect(report.totalFrames).toBe(recording.frames.length)
    expect(report.zonesDetected.length).toBe(0)
    expect(report.patternMatches.length).toBe(0)

    orch.dispose()
  })

  it('analyzeRecording emits sanitizer:analysis-complete with a matching report', async () => {
    const orch = new UIOrchestrator()
    const recording = await captureShortRecording(orch)

    const completePromise = firstValueFrom(
      eventBus.on('sanitizer:analysis-complete')
    )
    const textPerFrame = new Map<number, string>([[0, OPENAI_KEY_LINE]])
    const report = await orch.runSanitizer(recording, textPerFrame)

    const event = await completePromise
    expect(event.report.recordingId).toBe(report.recordingId)
    expect(event.report.totalFrames).toBe(report.totalFrames)
    expect(event.detectedZones.length).toBe(report.zonesDetected.length)

    orch.dispose()
  })
})
