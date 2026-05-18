/**
 * Watermark filter builder.
 *
 * Génère les arguments FFmpeg `-vf` pour appliquer un watermark (texte ou
 * image) sur la vidéo. Le caller injecte ces args dans `FfmpegOptions.extraArgs`.
 *
 * Note P0 : les coordonnées sont approximatives (padding 10px), suffisantes
 * pour la majorité des cas. Phase 3 pourra introduire un offset personnalisable.
 */

export type WatermarkPosition = 'tl' | 'tr' | 'bl' | 'br'

export interface WatermarkConfig {
  /** Texte du watermark. Mutuellement exclusif avec imagePath. */
  text?: string
  /** Chemin vers l'image (PNG/JPEG). Mutuellement exclusif avec text. */
  imagePath?: string
  /** Position : top-left / top-right / bottom-left / bottom-right. */
  position: WatermarkPosition
  /** Taille de police pour text (default 24). */
  fontSize?: number
  /** Couleur de police hex (default '#ffffff'). */
  fontColor?: string
}

interface XY {
  x: string
  y: string
}

const PADDING = 10

function coordsFor(position: WatermarkPosition): XY {
  switch (position) {
    case 'tl':
      return { x: `${PADDING}`, y: `${PADDING}` }
    case 'tr':
      return { x: `w-tw-${PADDING}`, y: `${PADDING}` }
    case 'bl':
      return { x: `${PADDING}`, y: `h-th-${PADDING}` }
    case 'br':
      return { x: `w-tw-${PADDING}`, y: `h-th-${PADDING}` }
  }
}

function coordsForOverlay(position: WatermarkPosition): XY {
  switch (position) {
    case 'tl':
      return { x: `${PADDING}`, y: `${PADDING}` }
    case 'tr':
      return { x: `W-w-${PADDING}`, y: `${PADDING}` }
    case 'bl':
      return { x: `${PADDING}`, y: `H-h-${PADDING}` }
    case 'br':
      return { x: `W-w-${PADDING}`, y: `H-h-${PADDING}` }
  }
}

/**
 * Construit les arguments FFmpeg pour le watermark.
 *
 * @returns Tableau d'args à concaténer dans `FfmpegOptions.extraArgs`.
 *   Ex : `['-vf', 'drawtext=text=PresentOtter:x=10:y=10:fontsize=24:fontcolor=#ffffff']`
 */
export function buildWatermarkFilter(config: WatermarkConfig): string[] {
  if (config.text === undefined && config.imagePath === undefined) {
    return []
  }

  if (config.text !== undefined) {
    const { x, y } = coordsFor(config.position)
    const fontSize = config.fontSize ?? 24
    const fontColor = config.fontColor ?? '#ffffff'
    const escaped = config.text.replace(/:/g, '\\:').replace(/'/g, "\\'")
    const filter =
      `drawtext=text='${escaped}'` +
      `:x=${x}:y=${y}` +
      `:fontsize=${fontSize}` +
      `:fontcolor=${fontColor}`
    return ['-vf', filter]
  }

  // imagePath
  const { x, y } = coordsForOverlay(config.position)
  // overlay accepte un second input ; le caller doit passer le watermark
  // comme -i additionnel. On retourne le filter_complex prêt à l'emploi.
  const filter = `[0:v][1:v]overlay=x=${x}:y=${y}`
  return ['-i', config.imagePath as string, '-filter_complex', filter]
}
