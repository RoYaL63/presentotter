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

/**
 * Adapter no-op qui jette PresentOtterError sur toute opération.
 *
 * Renvoyé par `createNodeFsAdapter()` quand le runtime n'a pas accès à
 * `node:fs` (renderer Electron sans `nodeIntegration`, navigateur, etc.).
 * Cela évite un ReferenceError au module-load et offre un diagnostic clair
 * si du code essaie quand même de toucher au filesystem côté renderer.
 */
function createUnavailableFsAdapter(): FileSystemAdapter {
  const fail = (op: string): never => {
    throw new Error(
      `[PresentOtter] node:fs is unavailable in this runtime (renderer process? browser?). ` +
        `Operation "${op}" must be routed through the main process via IPC.`
    )
  }
  return {
    existsSync: () => false,
    unlinkSync: () => fail('unlinkSync'),
    renameSync: () => fail('renameSync'),
    mkdirSync: () => fail('mkdirSync'),
    writeFileSync: () => fail('writeFileSync'),
    readFileSync: () => fail('readFileSync')
  }
}

export function createNodeFsAdapter(): FileSystemAdapter {
  // `require` n'existe pas en renderer Electron avec nodeIntegration:false.
  // On retourne un adapter no-op à la place — l'erreur sera explicite si
  // quelqu'un essaie quand même de toucher au FS, plutôt qu'un crash silencieux.
  type ReqFn = (id: string) => unknown
  const req =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { require?: ReqFn }).require === 'function'
      ? (globalThis as { require: ReqFn }).require
      : null
  if (req === null) {
    return createUnavailableFsAdapter()
  }
  const fs = req('node:fs') as {
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
