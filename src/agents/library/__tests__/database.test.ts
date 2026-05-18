import { describe, it, expect, beforeEach } from 'vitest'
import { RecordingDatabase } from '../database'
import { InMemoryAdapter } from '../in-memory-adapter'
import { eventBus } from '../../../../event-bus'
import type { RecordingLibraryEntry } from '../../../../interfaces'

function baseEntry(id: string, overrides: Partial<RecordingLibraryEntry> = {}) {
  return {
    id,
    name: `recording-${id}`,
    duration: 1000,
    sanitized: false,
    tags: [] as string[],
    ...overrides
  }
}

describe('RecordingDatabase', () => {
  let adapter: InMemoryAdapter
  let db: RecordingDatabase

  beforeEach(() => {
    adapter = new InMemoryAdapter()
    db = new RecordingDatabase(adapter)
  })

  it('create then findById returns the entry with createdAt/updatedAt filled', () => {
    const entry = db.create(baseEntry('a1'))
    expect(entry.createdAt).toBeInstanceOf(Date)
    expect(entry.updatedAt).toBeInstanceOf(Date)

    const found = db.findById('a1')
    expect(found).not.toBeNull()
    expect(found?.id).toBe('a1')
    expect(found?.name).toBe('recording-a1')
    expect(found?.createdAt).toBeInstanceOf(Date)
  })

  it('findAll returns multiple entries', () => {
    db.create(baseEntry('a1'))
    db.create(baseEntry('a2'))
    db.create(baseEntry('a3'))
    const all = db.findAll()
    expect(all).toHaveLength(3)
    const ids = all.map(e => e.id).sort()
    expect(ids).toEqual(['a1', 'a2', 'a3'])
  })

  it('update modifies fields and updatedAt changes', async () => {
    const created = db.create(baseEntry('a1'))
    const originalUpdatedAt = created.updatedAt.getTime()
    // Petit délai pour garantir un timestamp différent
    await new Promise(r => setTimeout(r, 2))
    const updated = db.update('a1', { name: 'renamed' })
    expect(updated).not.toBeNull()
    expect(updated?.name).toBe('renamed')
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt)
  })

  it('delete returns true then findById returns null', () => {
    db.create(baseEntry('a1'))
    expect(db.delete('a1')).toBe(true)
    expect(db.findById('a1')).toBeNull()
    expect(db.delete('a1')).toBe(false)
  })

  it('rename emits library:recording-renamed', () => {
    db.create(baseEntry('a1'))
    const events: Array<{ id: string; newName: string }> = []
    const sub = eventBus.on('library:recording-renamed').subscribe(p => {
      events.push(p)
    })
    const ok = db.rename('a1', 'new-name')
    sub.unsubscribe()
    expect(ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ id: 'a1', newName: 'new-name' })
  })

  it('setTags emits library:recording-tagged', () => {
    db.create(baseEntry('a1'))
    const events: Array<{ id: string; tags: string[] }> = []
    const sub = eventBus.on('library:recording-tagged').subscribe(p => {
      events.push(p)
    })
    const ok = db.setTags('a1', ['demo', 'tutorial'])
    sub.unsubscribe()
    expect(ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]?.tags).toEqual(['demo', 'tutorial'])
  })

  it('deleteRecording emits library:recording-deleted', () => {
    db.create(baseEntry('a1'))
    const events: Array<{ id: string }> = []
    const sub = eventBus.on('library:recording-deleted').subscribe(p => {
      events.push(p)
    })
    const ok = db.deleteRecording('a1')
    sub.unsubscribe()
    expect(ok).toBe(true)
    expect(events).toEqual([{ id: 'a1' }])
    expect(db.findById('a1')).toBeNull()
  })

  it('tags round-trip JSON ([] then stored then [foo,bar])', () => {
    db.create(baseEntry('a1', { tags: [] }))
    const empty = db.findById('a1')
    expect(empty?.tags).toEqual([])

    db.setTags('a1', ['foo', 'bar'])
    const tagged = db.findById('a1')
    expect(tagged?.tags).toEqual(['foo', 'bar'])
  })
})
