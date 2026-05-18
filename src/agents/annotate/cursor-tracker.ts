import type { CursorSample, Point } from './types'

/**
 * CursorTracker — ring buffer des N dernières positions du curseur.
 *
 * Utilitaire pur — n'interroge pas l'OS. La capture des positions
 * est faite ailleurs (capture agent) et passée via `record()`.
 *
 * Sert à dessiner :
 *  - une traînée (toutes les positions buffer)
 *  - un highlight (dernière position)
 */
export class CursorTracker {
  private buffer: CursorSample[] = []
  private readonly capacity: number

  constructor(capacity = 30) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  /**
   * Enregistre une position. Si le buffer est plein, évince la plus ancienne.
   */
  record(position: Point, frameIndex: number): void {
    this.buffer.push({ position: { x: position.x, y: position.y }, frameIndex })
    if (this.buffer.length > this.capacity) {
      this.buffer.shift()
    }
  }

  /**
   * Retourne la trail (copie) — ordre du plus ancien au plus récent.
   */
  getTrail(): CursorSample[] {
    return this.buffer.map(s => ({
      position: { x: s.position.x, y: s.position.y },
      frameIndex: s.frameIndex
    }))
  }

  /**
   * Dernière position connue, ou null si rien d'enregistré.
   */
  getHighlight(): Point | null {
    const last = this.buffer[this.buffer.length - 1]
    if (!last) return null
    return { x: last.position.x, y: last.position.y }
  }

  /**
   * Vide le buffer.
   */
  clear(): void {
    this.buffer = []
  }
}
