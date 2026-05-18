import type { FileSystemAdapter } from './storage'

/**
 * Interface contractuelle pour la génération de thumbnails.
 * Phase 3 : implémentation réelle via ffmpeg (extraction frame).
 */
export interface ThumbnailGenerator {
  generate(videoPath: string, outputPath: string, timestamp?: number): Promise<string>
}

/**
 * STUB P0 — Ne fait PAS d'extraction vidéo réelle.
 *
 * Écrit un Buffer vide à `outputPath` via le FileSystemAdapter,
 * puis retourne `outputPath`. Le `videoPath` et `timestamp` sont
 * acceptés pour matcher le contrat futur mais ignorés.
 *
 * Sera remplacé par une implémentation ffmpeg en Phase 3.
 */
export class MockThumbnailGenerator implements ThumbnailGenerator {
  constructor(private fs: FileSystemAdapter) {}

  async generate(
    _videoPath: string,
    outputPath: string,
    _timestamp?: number
  ): Promise<string> {
    this.fs.writeFileSync(outputPath, Buffer.alloc(0))
    return outputPath
  }
}
