import { describe, it, expect } from 'vitest'
import {
  searchByName,
  filterByTag,
  filterBySanitized,
  sortByDate
} from '../search'
import type { RecordingLibraryEntry } from '../../../../interfaces'

function entry(
  id: string,
  overrides: Partial<RecordingLibraryEntry> = {}
): RecordingLibraryEntry {
  return {
    id,
    name: `recording-${id}`,
    duration: 1000,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    sanitized: false,
    tags: [],
    ...overrides
  }
}

describe('search utilities', () => {
  it('searchByName matches case-insensitively', () => {
    const entries = [
      entry('1', { name: 'Demo Otter Tutorial' }),
      entry('2', { name: 'BORING webinar' }),
      entry('3', { name: 'otter chase 2026' })
    ]
    const results = searchByName(entries, 'OTTER')
    const ids = results.map(e => e.id).sort()
    expect(ids).toEqual(['1', '3'])
  })

  it('filterByTag returns only entries containing the tag', () => {
    const entries = [
      entry('1', { tags: ['demo', 'beta'] }),
      entry('2', { tags: ['demo'] }),
      entry('3', { tags: ['archive'] })
    ]
    const results = filterByTag(entries, 'demo')
    expect(results.map(e => e.id)).toEqual(['1', '2'])
  })

  it('filterBySanitized filters by boolean flag', () => {
    const entries = [
      entry('1', { sanitized: true }),
      entry('2', { sanitized: false }),
      entry('3', { sanitized: true })
    ]
    expect(filterBySanitized(entries, true).map(e => e.id)).toEqual(['1', '3'])
    expect(filterBySanitized(entries, false).map(e => e.id)).toEqual(['2'])
  })

  it('sortByDate works asc and desc and does not mutate input', () => {
    const entries = [
      entry('a', { createdAt: new Date('2026-03-01') }),
      entry('b', { createdAt: new Date('2026-01-01') }),
      entry('c', { createdAt: new Date('2026-02-01') })
    ]
    const original = entries.map(e => e.id)
    const asc = sortByDate(entries, 'asc').map(e => e.id)
    const desc = sortByDate(entries, 'desc').map(e => e.id)
    expect(asc).toEqual(['b', 'c', 'a'])
    expect(desc).toEqual(['a', 'c', 'b'])
    // input unchanged
    expect(entries.map(e => e.id)).toEqual(original)
  })
})
