import { eventBus } from '../../../event-bus'
import type {
  ExportFormat,
  RecordingLibraryEntry
} from '../../../interfaces'
import type { DatabaseAdapter } from './database-adapter'

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    duration INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    filePath TEXT,
    format TEXT,
    fileSize INTEGER,
    sanitized INTEGER NOT NULL,
    tags TEXT NOT NULL,
    thumbnailPath TEXT
  )
`.trim()

const INSERT_SQL =
  'INSERT INTO recordings (id, name, duration, createdAt, updatedAt, filePath, format, fileSize, sanitized, tags, thumbnailPath) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'

const SELECT_BY_ID_SQL = 'SELECT * FROM recordings WHERE id = ?'
const SELECT_ALL_SQL = 'SELECT * FROM recordings'
const DELETE_BY_ID_SQL = 'DELETE FROM recordings WHERE id = ?'
const UPDATE_BY_ID_SQL =
  'UPDATE recordings SET name = ?, duration = ?, updatedAt = ?, filePath = ?, format = ?, fileSize = ?, sanitized = ?, tags = ?, thumbnailPath = ? WHERE id = ?'

interface RawRow {
  id: string
  name: string
  duration: number
  createdAt: string
  updatedAt: string
  filePath: string | null
  format: string | null
  fileSize: number | null
  sanitized: number
  tags: string
  thumbnailPath: string | null
}

type CreateInput = Omit<RecordingLibraryEntry, 'createdAt' | 'updatedAt'> &
  Partial<Pick<RecordingLibraryEntry, 'createdAt' | 'updatedAt'>>

function rowToEntry(row: RawRow): RecordingLibraryEntry {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags) as unknown
    if (Array.isArray(parsed)) {
      tags = parsed.filter((t): t is string => typeof t === 'string')
    }
  } catch {
    tags = []
  }

  const entry: RecordingLibraryEntry = {
    id: row.id,
    name: row.name,
    duration: row.duration,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    sanitized: row.sanitized === 1,
    tags
  }
  if (row.filePath !== null && row.filePath !== undefined) {
    entry.filePath = row.filePath
  }
  if (row.format !== null && row.format !== undefined) {
    entry.format = row.format as ExportFormat
  }
  if (row.fileSize !== null && row.fileSize !== undefined) {
    entry.fileSize = row.fileSize
  }
  if (row.thumbnailPath !== null && row.thumbnailPath !== undefined) {
    entry.thumbnailPath = row.thumbnailPath
  }
  return entry
}

function entryToInsertParams(entry: RecordingLibraryEntry): unknown[] {
  return [
    entry.id,
    entry.name,
    entry.duration,
    entry.createdAt.toISOString(),
    entry.updatedAt.toISOString(),
    entry.filePath ?? null,
    entry.format ?? null,
    entry.fileSize ?? null,
    entry.sanitized ? 1 : 0,
    JSON.stringify(entry.tags),
    entry.thumbnailPath ?? null
  ]
}

function entryToUpdateParams(entry: RecordingLibraryEntry): unknown[] {
  return [
    entry.name,
    entry.duration,
    entry.updatedAt.toISOString(),
    entry.filePath ?? null,
    entry.format ?? null,
    entry.fileSize ?? null,
    entry.sanitized ? 1 : 0,
    JSON.stringify(entry.tags),
    entry.thumbnailPath ?? null,
    entry.id
  ]
}

/**
 * Façade typée autour d'un DatabaseAdapter pour les RecordingLibraryEntry.
 *
 * Toutes les opérations sont synchrones (better-sqlite3 l'est aussi).
 * Les helpers (rename / setTags / deleteRecording) émettent les events
 * `library:*` correspondants.
 */
export class RecordingDatabase {
  constructor(private adapter: DatabaseAdapter) {
    this.adapter.exec(CREATE_TABLE_SQL)
  }

  create(input: CreateInput): RecordingLibraryEntry {
    const now = new Date()
    const entry: RecordingLibraryEntry = {
      id: input.id,
      name: input.name,
      duration: input.duration,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      sanitized: input.sanitized,
      tags: [...input.tags]
    }
    if (input.filePath !== undefined) entry.filePath = input.filePath
    if (input.format !== undefined) entry.format = input.format
    if (input.fileSize !== undefined) entry.fileSize = input.fileSize
    if (input.thumbnailPath !== undefined) entry.thumbnailPath = input.thumbnailPath

    const stmt = this.adapter.prepare(INSERT_SQL)
    stmt.run(...entryToInsertParams(entry))
    return entry
  }

  findById(id: string): RecordingLibraryEntry | null {
    const stmt = this.adapter.prepare(SELECT_BY_ID_SQL)
    const row = stmt.get(id) as RawRow | undefined
    if (!row) return null
    return rowToEntry(row)
  }

  findAll(): RecordingLibraryEntry[] {
    const stmt = this.adapter.prepare(SELECT_ALL_SQL)
    const rows = stmt.all() as RawRow[]
    return rows.map(rowToEntry)
  }

  update(
    id: string,
    patch: Partial<RecordingLibraryEntry>
  ): RecordingLibraryEntry | null {
    const current = this.findById(id)
    if (!current) return null

    const next: RecordingLibraryEntry = {
      id: current.id,
      name: patch.name ?? current.name,
      duration: patch.duration ?? current.duration,
      createdAt: current.createdAt,
      updatedAt: new Date(),
      sanitized: patch.sanitized ?? current.sanitized,
      tags: patch.tags ? [...patch.tags] : [...current.tags]
    }
    const filePath = patch.filePath !== undefined ? patch.filePath : current.filePath
    if (filePath !== undefined) next.filePath = filePath
    const format = patch.format !== undefined ? patch.format : current.format
    if (format !== undefined) next.format = format
    const fileSize = patch.fileSize !== undefined ? patch.fileSize : current.fileSize
    if (fileSize !== undefined) next.fileSize = fileSize
    const thumbnailPath =
      patch.thumbnailPath !== undefined ? patch.thumbnailPath : current.thumbnailPath
    if (thumbnailPath !== undefined) next.thumbnailPath = thumbnailPath

    const stmt = this.adapter.prepare(UPDATE_BY_ID_SQL)
    const result = stmt.run(...entryToUpdateParams(next))
    if (result.changes === 0) return null
    return next
  }

  delete(id: string): boolean {
    const stmt = this.adapter.prepare(DELETE_BY_ID_SQL)
    const result = stmt.run(id)
    return result.changes > 0
  }

  rename(id: string, newName: string): boolean {
    const updated = this.update(id, { name: newName })
    if (!updated) return false
    eventBus.emit('library:recording-renamed', { id, newName })
    return true
  }

  setTags(id: string, tags: string[]): boolean {
    const updated = this.update(id, { tags })
    if (!updated) return false
    eventBus.emit('library:recording-tagged', { id, tags: [...tags] })
    return true
  }

  deleteRecording(id: string): boolean {
    const ok = this.delete(id)
    if (!ok) return false
    eventBus.emit('library:recording-deleted', { id })
    return true
  }
}
