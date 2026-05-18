/**
 * Storage layer — wrapper autour de node:fs derrière une interface injectable.
 *
 * Les tests passent un FileSystemAdapter mock (vi.fn) pour éviter de toucher
 * le disque ; le runtime utilise `createNodeFsAdapter`.
 */

export interface MkdirOptions {
  recursive?: boolean
}

export interface FileSystemAdapter {
  existsSync(path: string): boolean
  unlinkSync(path: string): void
  renameSync(from: string, to: string): void
  mkdirSync(path: string, opts?: MkdirOptions): void
  writeFileSync(path: string, data: Buffer | string): void
  readFileSync(path: string): Buffer
}

export function createNodeFsAdapter(): FileSystemAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as {
    existsSync(p: string): boolean
    unlinkSync(p: string): void
    renameSync(from: string, to: string): void
    mkdirSync(p: string, opts?: MkdirOptions): void
    writeFileSync(p: string, data: Buffer | string): void
    readFileSync(p: string): Buffer
  }
  return {
    existsSync: (p) => fs.existsSync(p),
    unlinkSync: (p) => fs.unlinkSync(p),
    renameSync: (from, to) => fs.renameSync(from, to),
    mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
    writeFileSync: (p, data) => fs.writeFileSync(p, data),
    readFileSync: (p) => fs.readFileSync(p)
  }
}

export class RecordingStorage {
  constructor(
    private fs: FileSystemAdapter,
    private recordingsDir: string
  ) {}

  /**
   * Supprime un fichier s'il existe. Retourne true si effectivement supprimé.
   */
  delete(filePath: string): boolean {
    if (!this.fs.existsSync(filePath)) return false
    this.fs.unlinkSync(filePath)
    return true
  }

  /**
   * Déplace un fichier (renameSync). Retourne true si la source existait.
   */
  move(from: string, to: string): boolean {
    if (!this.fs.existsSync(from)) return false
    this.fs.renameSync(from, to)
    return true
  }

  /**
   * Crée le dossier d'enregistrement s'il n'existe pas (recursive).
   */
  ensureRecordingsDir(): void {
    if (!this.fs.existsSync(this.recordingsDir)) {
      this.fs.mkdirSync(this.recordingsDir, { recursive: true })
    }
  }

  getRecordingsDir(): string {
    return this.recordingsDir
  }
}
