import { Subscription } from 'rxjs'
import { eventBus } from '../../../event-bus'
import type {
  ExportFormat,
  RecordingLibraryEntry
} from '../../../interfaces'
import type { RecordingDatabase } from './database'
import type { RecordingStorage } from './storage'
import type { ThumbnailGenerator } from './thumbnail-generator'

export interface LibraryManagerDeps {
  db: RecordingDatabase
  storage: RecordingStorage
  thumbnailGen: ThumbnailGenerator
}

/**
 * Détecte le format à partir de l'extension du fichier exporté.
 */
function detectFormat(outputPath: string): ExportFormat | undefined {
  const lower = outputPath.toLowerCase()
  if (lower.endsWith('.mp4')) return 'mp4'
  if (lower.endsWith('.webm')) return 'webm'
  if (lower.endsWith('.gif')) return 'gif'
  return undefined
}

function extractBaseName(outputPath: string): string {
  const norm = outputPath.replace(/\\/g, '/')
  const segments = norm.split('/')
  const last = segments[segments.length - 1] ?? outputPath
  const dot = last.lastIndexOf('.')
  return dot > 0 ? last.slice(0, dot) : last
}

/**
 * Façade qui combine database + storage + thumbnail et s'abonne à
 * `export:complete` pour créer automatiquement une entry.
 *
 * Le thumbnailGen est conservé pour la Phase 3 (génération asynchrone
 * post-export). Pour le P0 on crée juste la metadata.
 */
export class LibraryManager {
  private subscriptions: Subscription[] = []

  constructor(private deps: LibraryManagerDeps) {
    this.bindEvents()
  }

  private bindEvents(): void {
    const sub = eventBus.on('export:complete').subscribe(payload => {
      this.handleExportComplete(payload)
    })
    this.subscriptions.push(sub)
  }

  private handleExportComplete(payload: {
    outputPath: string
    fileSize: number
    duration: number
  }): RecordingLibraryEntry {
    const id = this.generateId()
    const name = extractBaseName(payload.outputPath)
    const format = detectFormat(payload.outputPath)
    const entry: Parameters<RecordingDatabase['create']>[0] = {
      id,
      name,
      duration: payload.duration,
      filePath: payload.outputPath,
      fileSize: payload.fileSize,
      sanitized: false,
      tags: []
    }
    if (format !== undefined) entry.format = format
    return this.deps.db.create(entry)
  }

  private generateId(): string {
    // ID temporaire : timestamp + random. Phase 3 utilisera crypto.randomUUID.
    const ts = Date.now().toString(36)
    const rand = Math.random().toString(36).slice(2, 10)
    return `rec_${ts}_${rand}`
  }

  /**
   * Libère les souscriptions event-bus. À appeler à la fermeture de l'app.
   */
  dispose(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe()
    }
    this.subscriptions = []
  }
}
