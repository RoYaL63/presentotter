import type {
  CaptureConfig,
  CaptureSession,
  RawRecording,
  SanitizedRecording,
  SanitizeReport,
  ExportConfig,
  RecordingLibraryEntry,
  Annotation
} from '../../../interfaces'

import { CaptureSessionManager } from '../capture'
import { SanitizerAnalyzer } from '../sanitizer'
import { AnnotationStore } from '../annotate'
import {
  RecordingDatabase,
  RecordingStorage,
  MockThumbnailGenerator,
  LibraryManager,
  InMemoryAdapter,
  createNodeFsAdapter
} from '../library'
import { VideoEncoder, MockFfmpegAdapter } from '../export'

/**
 * Orchestrateur UI — couche d'intégration qui branche tous les agents aux
 * pages React.
 *
 * Pour le P0 : adapters mock pour DB et FFmpeg (en production, swap pour
 * `createBetterSqlite3Adapter` et `createFluentFfmpegAdapter`).
 *
 * NOTE Phase 3 : c'est l'UNIQUE endroit du codebase qui importe les façades
 * publiques de plusieurs agents — c'est légitime parce qu'on est la couche
 * d'intégration. Les agents continuent de bavarder via eventBus entre eux.
 */
export class UIOrchestrator {
  private captureManager: CaptureSessionManager | null = null
  readonly annotations: AnnotationStore
  readonly analyzer: SanitizerAnalyzer
  readonly db: RecordingDatabase
  readonly storage: RecordingStorage
  readonly libraryManager: LibraryManager
  readonly encoder: VideoEncoder
  private lastRawRecording: RawRecording | null = null

  constructor() {
    this.annotations = new AnnotationStore()
    this.analyzer = new SanitizerAnalyzer()
    const dbAdapter = new InMemoryAdapter()
    this.db = new RecordingDatabase(dbAdapter)
    const fs = createNodeFsAdapter()
    this.storage = new RecordingStorage(fs, '/recordings')
    const thumbnailGen = new MockThumbnailGenerator(fs)
    this.libraryManager = new LibraryManager({
      db: this.db,
      storage: this.storage,
      thumbnailGen
    })
    const ffmpegAdapter = new MockFfmpegAdapter()
    this.encoder = new VideoEncoder({ adapter: ffmpegAdapter })
  }

  // ---------- Capture ----------

  async startCapture(config: CaptureConfig): Promise<CaptureSession> {
    if (this.captureManager) {
      throw new Error('A capture session is already active')
    }
    this.captureManager = new CaptureSessionManager(config)
    return await this.captureManager.start()
  }

  pauseCapture(): void {
    this.captureManager?.pause()
  }

  resumeCapture(): void {
    this.captureManager?.resume()
  }

  async stopCapture(): Promise<RawRecording | null> {
    if (!this.captureManager) return null
    const session = await this.captureManager.stop()
    this.captureManager = null
    const raw = session.rawRecording ?? null
    this.lastRawRecording = raw
    return raw
  }

  addBookmark(label?: string): void {
    this.captureManager?.addBookmark(label)
  }

  getLastRecording(): RawRecording | null {
    return this.lastRawRecording
  }

  // ---------- Annotations ----------

  addAnnotation(annotation: Annotation): void {
    this.annotations.add(annotation)
  }

  // ---------- Sanitizer ----------

  async runSanitizer(
    recording: RawRecording,
    textPerFrame: Map<number, string> = new Map()
  ): Promise<SanitizeReport> {
    return await this.analyzer.analyzeRecording(recording, textPerFrame)
  }

  // ---------- Export ----------

  async exportRecording(
    recording: RawRecording | SanitizedRecording,
    config: ExportConfig
  ): Promise<{ outputPath: string; fileSize: number; duration: number }> {
    return await this.encoder.encode(recording, config)
  }

  cancelExport(recordingId: string): void {
    this.encoder.cancel(recordingId)
  }

  // ---------- Library ----------

  getLibraryEntries(): RecordingLibraryEntry[] {
    return this.db.findAll()
  }

  deleteLibraryEntry(id: string): boolean {
    return this.db.deleteRecording(id)
  }

  renameLibraryEntry(id: string, newName: string): boolean {
    return this.db.rename(id, newName)
  }

  setLibraryEntryTags(id: string, tags: string[]): boolean {
    return this.db.setTags(id, tags)
  }

  // ---------- Lifecycle ----------

  dispose(): void {
    this.libraryManager.dispose()
  }
}

/** Singleton P0 — sera revu en Phase 4 si on veut isoler des instances par fenêtre. */
export const orchestrator = new UIOrchestrator()
