import type {
  DatabaseAdapter,
  PreparedStatement,
  PreparedStatementRunResult
} from './database-adapter'

/**
 * Adapter in-memory utilisé pour les tests.
 *
 * Ce n'est PAS un vrai parseur SQL : on reconnaît juste les patterns que
 * `RecordingDatabase` envoie (INSERT / SELECT / UPDATE / DELETE / CREATE TABLE).
 * Chaque ligne est un Record<string, unknown> indexé par id.
 */

type Row = Record<string, unknown>

interface ParsedStatement {
  kind: 'insert' | 'selectById' | 'selectAll' | 'updateById' | 'deleteById' | 'create' | 'noop'
  columns?: string[]
  setColumns?: string[]
}

function parseSql(sql: string): ParsedStatement {
  const trimmed = sql.trim().replace(/\s+/g, ' ')
  const upper = trimmed.toUpperCase()

  if (upper.startsWith('CREATE TABLE')) {
    return { kind: 'create' }
  }

  if (upper.startsWith('INSERT INTO RECORDINGS')) {
    // ex: INSERT INTO recordings (id, name, duration, ...) VALUES (?, ?, ...)
    const match = trimmed.match(/INSERT INTO recordings\s*\(([^)]+)\)/i)
    if (match && match[1]) {
      const columns = match[1].split(',').map(c => c.trim())
      return { kind: 'insert', columns }
    }
    return { kind: 'insert', columns: [] }
  }

  if (upper.startsWith('SELECT * FROM RECORDINGS WHERE ID')) {
    return { kind: 'selectById' }
  }

  if (upper.startsWith('SELECT * FROM RECORDINGS')) {
    return { kind: 'selectAll' }
  }

  if (upper.startsWith('UPDATE RECORDINGS SET')) {
    // ex: UPDATE recordings SET name = ?, updatedAt = ? WHERE id = ?
    const match = trimmed.match(/UPDATE recordings SET (.+) WHERE id = \?/i)
    if (match && match[1]) {
      const assignments = match[1].split(',').map(a => a.trim())
      const setColumns = assignments
        .map(a => a.split('=')[0]?.trim() ?? '')
        .filter(Boolean)
      return { kind: 'updateById', setColumns }
    }
    return { kind: 'updateById', setColumns: [] }
  }

  if (upper.startsWith('DELETE FROM RECORDINGS WHERE ID')) {
    return { kind: 'deleteById' }
  }

  return { kind: 'noop' }
}

export class InMemoryAdapter implements DatabaseAdapter {
  private rows = new Map<string, Row>()
  private insertCounter = 0

  prepare(sql: string): PreparedStatement {
    const parsed = parseSql(sql)

    return {
      run: (...params: unknown[]): PreparedStatementRunResult => {
        switch (parsed.kind) {
          case 'insert': {
            const cols = parsed.columns ?? []
            const row: Row = {}
            for (let i = 0; i < cols.length; i++) {
              const key = cols[i]
              if (key !== undefined) {
                row[key] = params[i] ?? null
              }
            }
            const id = String(row['id'] ?? '')
            if (id.length === 0) {
              return { changes: 0, lastInsertRowid: 0 }
            }
            this.rows.set(id, row)
            this.insertCounter += 1
            return { changes: 1, lastInsertRowid: this.insertCounter }
          }
          case 'updateById': {
            const setCols = parsed.setColumns ?? []
            const id = String(params[params.length - 1] ?? '')
            const row = this.rows.get(id)
            if (!row) {
              return { changes: 0, lastInsertRowid: 0 }
            }
            for (let i = 0; i < setCols.length; i++) {
              const key = setCols[i]
              if (key !== undefined) {
                row[key] = params[i] ?? null
              }
            }
            this.rows.set(id, row)
            return { changes: 1, lastInsertRowid: 0 }
          }
          case 'deleteById': {
            const id = String(params[0] ?? '')
            const existed = this.rows.delete(id)
            return { changes: existed ? 1 : 0, lastInsertRowid: 0 }
          }
          default:
            return { changes: 0, lastInsertRowid: 0 }
        }
      },
      get: (...params: unknown[]): unknown => {
        if (parsed.kind === 'selectById') {
          const id = String(params[0] ?? '')
          return this.rows.get(id) ?? undefined
        }
        return undefined
      },
      all: (..._params: unknown[]): unknown[] => {
        if (parsed.kind === 'selectAll') {
          return Array.from(this.rows.values())
        }
        return []
      }
    }
  }

  exec(_sql: string): void {
    // CREATE TABLE est no-op : le Map sert de table.
  }

  close(): void {
    this.rows.clear()
  }

  // Utilitaire pour les tests
  size(): number {
    return this.rows.size
  }
}
