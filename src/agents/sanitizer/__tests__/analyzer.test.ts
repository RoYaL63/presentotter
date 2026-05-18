import { describe, it, expect } from 'vitest'
import { SanitizerAnalyzer } from '../analyzer'
import { eventBus } from '../../../../event-bus'
import type { RawRecording, VideoFrame } from '../../../../interfaces'

/**
 * Crée une frame fictive minimale (1x1 RGBA) pour ne pas dépendre
 * d'un buffer réel — l'analyzer ne lit pas le pixel data.
 */
function fakeFrame(timestamp: number): VideoFrame {
  return {
    data: Buffer.alloc(4, 0),
    width: 1,
    height: 1,
    timestamp,
    format: 'rgba'
  }
}

function fakeRecording(frameCount: number, id = 'rec-test'): RawRecording {
  return {
    id,
    frames: Array.from({ length: frameCount }, (_, i) => fakeFrame(i * 33)),
    audioData: Buffer.alloc(0),
    duration: frameCount * 33,
    config: {
      source: 'screen',
      width: 1,
      height: 1,
      fps: 30,
      audioInputs: { system: false, microphone: false }
    },
    bookmarks: [],
    createdAt: new Date()
  }
}

describe('SanitizerAnalyzer.analyzeText', () => {
  const analyzer = new SanitizerAnalyzer()

  it('detects multiple secret types in mixed text', () => {
    const text = [
      'export OPENAI_KEY=sk-ABCDEFGHIJ1234567890abcdef',
      'jwt token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'aws id AKIAIOSFODNN7EXAMPLE',
      'auth Bearer abcdef1234567890ABCDEF._-payload'
    ].join('\n')

    const zones = analyzer.analyzeText(text)
    const patternNames = zones.map(z => z.pattern)

    expect(patternNames).toContain('openai-api-key')
    expect(patternNames).toContain('jwt')
    expect(patternNames).toContain('aws-access-key')
    expect(patternNames).toContain('bearer-token')
  })

  it('returns confidence and type matching the pattern definition', () => {
    const text = 'sk-ABCDEFGHIJ1234567890abcdef'
    const zones = analyzer.analyzeText(text)
    const openai = zones.find(z => z.pattern === 'openai-api-key')
    expect(openai).toBeDefined()
    expect(openai?.type).toBe('api-key')
    expect(openai?.confidence).toBeCloseTo(0.98)
  })

  it('returns empty array on clean text', () => {
    const zones = analyzer.analyzeText('the quick brown otter jumps')
    // env-var pattern peut matcher si on a "XXX=12345678" — phrase est safe
    expect(zones.length).toBe(0)
  })

  it('jwt has confidence >= 0.85 (G3 gate)', () => {
    const zones = analyzer.analyzeText(
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    )
    const jwt = zones.find(z => z.pattern === 'jwt')
    expect(jwt?.confidence).toBeGreaterThanOrEqual(0.85)
  })
})

describe('SanitizerAnalyzer.analyzeRecording', () => {
  it('aggregates detections across frames and emits events', async () => {
    const analyzer = new SanitizerAnalyzer()
    const recording = fakeRecording(20)

    // Le même secret apparaît dans 3 frames -> 1 zone avec 3 frameIndices
    const textMap = new Map<number, string>()
    textMap.set(0, 'AKIAIOSFODNN7EXAMPLE')
    textMap.set(5, 'AKIAIOSFODNN7EXAMPLE')
    textMap.set(15, 'AKIAIOSFODNN7EXAMPLE')
    // Un autre secret isolé
    textMap.set(10, 'Bearer abcdef1234567890ABCDEF._-payload')

    const events: string[] = []
    const sub1 = eventBus.on('sanitizer:analysis-started').subscribe(() => {
      events.push('started')
    })
    const sub2 = eventBus.on('sanitizer:progress').subscribe(() => {
      events.push('progress')
    })
    const sub3 = eventBus.on('sanitizer:analysis-complete').subscribe(() => {
      events.push('complete')
    })

    const report = await analyzer.analyzeRecording(recording, textMap)

    sub1.unsubscribe()
    sub2.unsubscribe()
    sub3.unsubscribe()

    expect(report.recordingId).toBe('rec-test')
    expect(report.totalFrames).toBe(20)

    const aws = report.zonesDetected.find(z => z.pattern === 'aws-access-key')
    expect(aws).toBeDefined()
    expect(aws?.frameIndices).toEqual([0, 5, 15])

    const bearer = report.zonesDetected.find(z => z.pattern === 'bearer-token')
    expect(bearer).toBeDefined()
    expect(bearer?.frameIndices).toEqual([10])

    expect(events[0]).toBe('started')
    expect(events.at(-1)).toBe('complete')
    expect(events.filter(e => e === 'progress').length).toBeGreaterThan(0)

    const awsCount = report.patternMatches.find(
      p => p.pattern === 'aws-access-key'
    )
    expect(awsCount?.count).toBe(3)
  })

  it('returns empty zones on a recording with no detectable text', async () => {
    const analyzer = new SanitizerAnalyzer()
    const recording = fakeRecording(5, 'rec-clean')
    const textMap = new Map<number, string>([
      [0, 'hello world'],
      [1, 'just text']
    ])
    const report = await analyzer.analyzeRecording(recording, textMap)
    expect(report.zonesDetected).toEqual([])
  })
})
