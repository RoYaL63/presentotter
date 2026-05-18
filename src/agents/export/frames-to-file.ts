import { Readable } from 'node:stream'
import type { RawRecording } from '../../../interfaces'

/**
 * Génère les paths attendus pour un usage `ffmpeg -f concat -i list.txt`.
 *
 * Note P0 : retourne juste les paths sans écrire les frames sur disque. La
 * vraie écriture (PNG ou raw) sera implémentée en Phase 3/4 quand on aura
 * intégré la capture Windows Graphics et qu'il faudra traiter de gros
 * volumes de frames.
 */
export function framesToConcatFileList(
  recording: RawRecording,
  framesDir: string
): { listPath: string; framePaths: string[] } {
  const safeDir = framesDir.replace(/[/\\]$/, '')
  const framePaths = recording.frames.map((_frame, i) => {
    const padded = i.toString().padStart(6, '0')
    return `${safeDir}/frame_${padded}.png`
  })
  const listPath = `${safeDir}/concat_list.txt`
  return { listPath, framePaths }
}

/**
 * Convertit les frames du recording en stream lisible (Buffer concaténés).
 *
 * Pour P0, retourne un stream simple basé sur le buffer de chaque frame.
 * Adapté pour `ffmpeg -f rawvideo -pix_fmt rgba -s WxH -i pipe:0`.
 */
export function framesToRawVideoPipe(recording: RawRecording): Readable {
  const buffers = recording.frames.map(f => f.data)
  return Readable.from(buffers)
}
