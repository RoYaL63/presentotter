import type { RecordingLibraryEntry } from '../../../interfaces'

/**
 * Filtrage en mémoire — pas de SQL pour rester simple et testable.
 * Pour des libraries de >10k entries on passera à un index SQL FTS5.
 */

export function searchByName(
  entries: RecordingLibraryEntry[],
  query: string
): RecordingLibraryEntry[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return [...entries]
  return entries.filter(e => e.name.toLowerCase().includes(q))
}

export function filterByTag(
  entries: RecordingLibraryEntry[],
  tag: string
): RecordingLibraryEntry[] {
  return entries.filter(e => e.tags.includes(tag))
}

export function filterBySanitized(
  entries: RecordingLibraryEntry[],
  sanitized: boolean
): RecordingLibraryEntry[] {
  return entries.filter(e => e.sanitized === sanitized)
}

export function sortByDate(
  entries: RecordingLibraryEntry[],
  direction: 'asc' | 'desc'
): RecordingLibraryEntry[] {
  const sorted = [...entries]
  sorted.sort((a, b) => {
    const diff = a.createdAt.getTime() - b.createdAt.getTime()
    return direction === 'asc' ? diff : -diff
  })
  return sorted
}
