import { eventBus } from '../../../event-bus'
import type {
  DetectedZone,
  RawRecording,
  SanitizeReport
} from '../../../interfaces'
import { PATTERNS } from './patterns'

/**
 * Analyzer pur (sans dépendance OCR directe).
 * L'OCR (tesseract.js) est piloté en amont — on accepte une map
 * frameIndex -> text pour rester rapide et testable.
 */
export class SanitizerAnalyzer {
  /**
   * Applique tous les patterns sur du texte brut.
   * Retourne une DetectedZone par match (frameIndices vide ici,
   * c'est analyzeRecording qui les agrège par frame).
   */
  analyzeText(text: string): DetectedZone[] {
    const zones: DetectedZone[] = []

    for (const pattern of PATTERNS) {
      // Reset lastIndex car regex globales sont stateful
      pattern.regex.lastIndex = 0
      const matches = text.matchAll(pattern.regex)

      for (const _match of matches) {
        zones.push({
          type: pattern.zoneType,
          pattern: pattern.name,
          frameIndices: [],
          confidence: pattern.confidence
        })
      }
    }

    return zones
  }

  /**
   * Analyse l'ensemble des frames d'un recording.
   * Émet :
   *  - sanitizer:analysis-started au début
   *  - sanitizer:progress tous les ~10% de progression
   *  - sanitizer:analysis-complete à la fin
   */
  async analyzeRecording(
    recording: RawRecording,
    textPerFrame: Map<number, string>
  ): Promise<SanitizeReport> {
    const totalFrames = recording.frames.length

    eventBus.emit('sanitizer:analysis-started', {
      recordingId: recording.id,
      frameCount: totalFrames
    })

    // Agrégation : on regroupe les détections par (pattern,type) et on
    // accumule les frameIndices pour éviter une explosion de zones.
    const aggregated = new Map<string, DetectedZone>()
    const patternCounts = new Map<string, number>()

    // Seuil de progression : tous les 10% (ou à chaque frame si < 10 frames)
    const progressStep = Math.max(1, Math.floor(totalFrames / 10))
    let lastEmittedPercent = -1

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      const text = textPerFrame.get(frameIndex) ?? ''

      if (text.length > 0) {
        const zones = this.analyzeText(text)

        for (const zone of zones) {
          const key = `${zone.pattern}::${zone.type}`
          patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1)

          const existing = aggregated.get(key)
          if (existing) {
            // Ajout idempotent du frameIndex
            if (!existing.frameIndices.includes(frameIndex)) {
              existing.frameIndices.push(frameIndex)
            }
          } else {
            aggregated.set(key, {
              type: zone.type,
              pattern: zone.pattern,
              frameIndices: [frameIndex],
              confidence: zone.confidence
            })
          }
        }
      }

      // Émission progress tous les ~10%
      if ((frameIndex + 1) % progressStep === 0 || frameIndex === totalFrames - 1) {
        const percent = Math.floor(((frameIndex + 1) / totalFrames) * 100)
        if (percent !== lastEmittedPercent) {
          eventBus.emit('sanitizer:progress', {
            percent,
            zonesFound: aggregated.size
          })
          lastEmittedPercent = percent
        }
      }
    }

    const zonesDetected = Array.from(aggregated.values())
    const patternMatches = Array.from(patternCounts.entries()).map(
      ([key, count]) => ({
        pattern: key.split('::')[0] ?? key,
        count
      })
    )

    const report: SanitizeReport = {
      recordingId: recording.id,
      totalFrames,
      zonesDetected,
      patternMatches,
      analyzedAt: new Date()
    }

    eventBus.emit('sanitizer:analysis-complete', {
      report,
      detectedZones: zonesDetected
    })

    return report
  }
}
