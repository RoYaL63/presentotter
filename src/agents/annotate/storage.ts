import type { Annotation } from '../../../interfaces'
import { eventBus } from '../../../event-bus'

/**
 * AnnotationStore — store in-memory + sérialisation JSON.
 *
 * P0 : pas de SQLite (collision avec Archive). better-sqlite3 sera
 * intégré en Phase 3 par Archive ; on persistera alors via cet agent.
 *
 * Émet sur l'event bus :
 *  - `annotation:added`   (annotationId, frameIndex)
 *  - `annotation:removed` (annotationId)
 *  - `annotation:updated` (annotationId)
 */
export class AnnotationStore {
  private annotations: Map<string, Annotation> = new Map()

  /**
   * Ajoute une annotation. Si l'id existe déjà, écrase (cas import JSON).
   */
  add(annotation: Annotation): void {
    this.annotations.set(annotation.id, annotation)
    eventBus.emit('annotation:added', {
      annotationId: annotation.id,
      frameIndex: annotation.startFrame
    })
  }

  /**
   * Supprime une annotation par id. No-op si l'id n'existe pas.
   */
  remove(id: string): void {
    if (!this.annotations.has(id)) return
    this.annotations.delete(id)
    eventBus.emit('annotation:removed', { annotationId: id })
  }

  /**
   * Update partiel (préserve les champs non-patchés).
   * L'id du patch est ignoré pour éviter une réindexation accidentelle.
   */
  update(id: string, patch: Partial<Annotation>): void {
    const current = this.annotations.get(id)
    if (!current) return
    const { id: _ignored, ...rest } = patch
    void _ignored
    const merged: Annotation = { ...current, ...rest, id: current.id }
    this.annotations.set(id, merged)
    eventBus.emit('annotation:updated', { annotationId: id })
  }

  /**
   * Retourne toutes les annotations (copie superficielle du tableau).
   */
  getAll(): Annotation[] {
    return Array.from(this.annotations.values())
  }

  /**
   * Retourne les annotations actives à `frameIndex`
   * (startFrame <= frameIndex <= endFrame).
   */
  getByFrame(frameIndex: number): Annotation[] {
    const out: Annotation[] = []
    for (const annotation of this.annotations.values()) {
      if (frameIndex >= annotation.startFrame && frameIndex <= annotation.endFrame) {
        out.push(annotation)
      }
    }
    return out
  }

  /**
   * Sérialise toutes les annotations en JSON.
   */
  toJSON(): string {
    return JSON.stringify(this.getAll())
  }

  /**
   * Remplace le contenu du store par les annotations sérialisées.
   * N'émet PAS d'événements (opération bulk d'import).
   */
  fromJSON(json: string): void {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return
    this.annotations.clear()
    for (const item of parsed) {
      if (!isAnnotation(item)) continue
      this.annotations.set(item.id, item)
    }
  }

  /**
   * Vide le store. N'émet pas d'événements (cleanup bulk).
   */
  clear(): void {
    this.annotations.clear()
  }
}

/**
 * Type guard pour validation à l'import JSON.
 */
function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.type === 'string' &&
    typeof v.color === 'string' &&
    typeof v.opacity === 'number' &&
    typeof v.startFrame === 'number' &&
    typeof v.endFrame === 'number'
  )
}
