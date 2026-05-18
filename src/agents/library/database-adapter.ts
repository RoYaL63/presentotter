/**
 * Database adapter — abstrait better-sqlite3 derrière une interface minimale.
 *
 * Pourquoi : better-sqlite3 est un module natif compilé qui ne peut pas être
 * chargé en sandbox de test. On injecte donc l'adapter dans `RecordingDatabase`
 * et on utilise `InMemoryAdapter` pour les tests, `createBetterSqlite3Adapter`
 * en production runtime.
 */

export interface PreparedStatementRunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface PreparedStatement {
  run(...params: unknown[]): PreparedStatementRunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface DatabaseAdapter {
  prepare(sql: string): PreparedStatement
  exec(sql: string): void
  close(): void
}

/**
 * Factory better-sqlite3 (runtime uniquement, jamais utilisé en test).
 *
 * Le require est dynamique pour éviter que le module natif soit résolu
 * au moment du parse — il ne sera chargé qu'à l'appel de la factory.
 */
export function createBetterSqlite3Adapter(dbPath: string): DatabaseAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as new (path: string) => {
    prepare(sql: string): PreparedStatement
    exec(sql: string): void
    close(): void
  }
  const db = new Database(dbPath)
  return {
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    close: () => db.close()
  }
}
