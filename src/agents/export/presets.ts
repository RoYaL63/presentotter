import type { ExportFormat, ExportPreset, ExportConfig } from '../../../interfaces'

/**
 * Catalogue des presets P0.
 *
 * Les bitrates sont indicatifs et peuvent être tunés en Phase 3 selon les
 * résultats de benchmarks réels.
 */
export const PRESETS: Record<string, ExportPreset> = {
  MP4_TUTORIAL_HD: {
    name: 'MP4 Tutorial HD',
    codec: 'libx264',
    bitrate: '5000k',
    scale: '1920x1080',
    fps: 30
  },
  MP4_DEMO_LIGHT: {
    name: 'MP4 Demo Light',
    codec: 'libx264',
    bitrate: '2500k',
    scale: '1280x720',
    fps: 30
  },
  MP4_LOSSLESS: {
    name: 'MP4 Lossless',
    codec: 'libx264',
    bitrate: 'crf=0',
    fps: 30
  },
  WEBM_WEB: {
    name: 'WebM Web',
    codec: 'libvpx-vp9',
    bitrate: '2000k',
    scale: '1280x720',
    fps: 30
  },
  GIF_SOCIAL: {
    name: 'GIF Social',
    codec: 'gif',
    bitrate: 'n/a',
    scale: '800x450',
    fps: 15
  },
  GIF_HD: {
    name: 'GIF HD',
    codec: 'gif',
    bitrate: 'n/a',
    scale: '1280x720',
    fps: 20
  }
}

/**
 * Retourne le preset adapté à une combinaison (format, quality).
 *
 * Règles :
 * - mp4 + lossless → MP4_LOSSLESS
 * - mp4 + (low|medium) → MP4_DEMO_LIGHT
 * - mp4 + high → MP4_TUTORIAL_HD
 * - webm → WEBM_WEB
 * - gif + (low|medium) → GIF_SOCIAL
 * - gif + (high|lossless) → GIF_HD
 */
export function getPresetForFormat(
  format: ExportFormat,
  quality: ExportConfig['quality']
): ExportPreset {
  if (format === 'mp4') {
    if (quality === 'lossless') return PRESETS.MP4_LOSSLESS as ExportPreset
    if (quality === 'high') return PRESETS.MP4_TUTORIAL_HD as ExportPreset
    return PRESETS.MP4_DEMO_LIGHT as ExportPreset
  }
  if (format === 'webm') {
    return PRESETS.WEBM_WEB as ExportPreset
  }
  // gif
  if (quality === 'high' || quality === 'lossless') {
    return PRESETS.GIF_HD as ExportPreset
  }
  return PRESETS.GIF_SOCIAL as ExportPreset
}
