import { describe, it, expect } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { AnnotationStore } from '../storage'
import { eventBus } from '../../../../event-bus'
import type { Annotation } from '../../../../interfaces'

function makeAnnotation(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    type: 'rectangle',
    color: '#FF0000',
    opacity: 1,
    startFrame: 0,
    endFrame: 100,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    ...overrides
  }
}

describe('AnnotationStore', () => {
  it('add then getAll returns the inserted annotation', () => {
    const store = new AnnotationStore()
    const a = makeAnnotation('a1')
    store.add(a)
    expect(store.getAll()).toHaveLength(1)
    expect(store.getAll()[0]?.id).toBe('a1')
  })

  it('remove deletes the annotation', () => {
    const store = new AnnotationStore()
    store.add(makeAnnotation('a1'))
    store.add(makeAnnotation('a2'))
    store.remove('a1')
    expect(store.getAll()).toHaveLength(1)
    expect(store.getAll()[0]?.id).toBe('a2')
  })

  it('update preserves fields not present in the patch', () => {
    const store = new AnnotationStore()
    const a = makeAnnotation('a1', { color: '#FF0000', opacity: 0.5 })
    store.add(a)
    store.update('a1', { color: '#00FF00' })
    const after = store.getAll()[0]!
    expect(after.color).toBe('#00FF00')
    // opacity NON patché : doit rester 0.5.
    expect(after.opacity).toBe(0.5)
    expect(after.bbox).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('getByFrame returns only annotations active at the given index', () => {
    const store = new AnnotationStore()
    store.add(makeAnnotation('early', { startFrame: 0, endFrame: 10 }))
    store.add(makeAnnotation('mid', { startFrame: 20, endFrame: 30 }))
    store.add(makeAnnotation('late', { startFrame: 100, endFrame: 200 }))
    const active = store.getByFrame(25)
    expect(active).toHaveLength(1)
    expect(active[0]?.id).toBe('mid')
  })

  it('JSON round-trip preserves all annotations', () => {
    const store = new AnnotationStore()
    store.add(
      makeAnnotation('a1', {
        type: 'arrow',
        points: [
          { x: 1, y: 1 },
          { x: 5, y: 5 }
        ]
      })
    )
    store.add(makeAnnotation('a2', { type: 'text', text: 'hello' }))

    const json = store.toJSON()
    const next = new AnnotationStore()
    next.fromJSON(json)
    expect(next.getAll()).toHaveLength(2)
    const a1 = next.getAll().find(a => a.id === 'a1')
    expect(a1?.type).toBe('arrow')
    expect(a1?.points).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 5 }
    ])
  })

  it('emits annotation:added on add() with the right payload', async () => {
    const store = new AnnotationStore()
    const eventPromise = firstValueFrom(eventBus.on('annotation:added'))
    store.add(makeAnnotation('evt1', { startFrame: 42 }))
    const payload = await eventPromise
    expect(payload.annotationId).toBe('evt1')
    expect(payload.frameIndex).toBe(42)
  })
})
