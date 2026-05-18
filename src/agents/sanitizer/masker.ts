import type { DetectedZone, VideoFrame } from '../../../interfaces'

/**
 * Bounding box d'une zone à masquer.
 * Aligné sur DetectedZone.bbox (déjà défini dans interfaces.ts).
 */
export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export type RGBA = readonly [number, number, number, number]

const CHANNELS = 4 // RGBA

/**
 * Clamp d'une bbox aux dimensions effectives de la frame.
 * Évite tout out-of-bounds quand la détection déborde du cadre.
 */
function clampBBox(bbox: BBox, width: number, height: number): BBox {
  const x = Math.max(0, Math.min(bbox.x, width))
  const y = Math.max(0, Math.min(bbox.y, height))
  const w = Math.max(0, Math.min(bbox.width, width - x))
  const h = Math.max(0, Math.min(bbox.height, height - y))
  return { x, y, width: w, height: h }
}

/**
 * Copie défensive du buffer pour ne jamais muter la frame source.
 */
function cloneFrame(frame: VideoFrame): VideoFrame {
  return {
    data: Buffer.from(frame.data),
    width: frame.width,
    height: frame.height,
    timestamp: frame.timestamp,
    format: frame.format
  }
}

/**
 * Calcule l'index linéaire dans le buffer RGBA.
 */
function idx(x: number, y: number, width: number): number {
  return (y * width + x) * CHANNELS
}

/**
 * Flou simple par moyenne 5x5 (box blur) sur la zone.
 * Pas le plus rapide ni le plus joli, mais suffisant en P0.
 */
export function applyBlur(frame: VideoFrame, bbox: BBox): VideoFrame {
  if (frame.format !== 'rgba') {
    // Seul RGBA est supporté en P0
    return frame
  }
  const out = cloneFrame(frame)
  const box = clampBBox(bbox, frame.width, frame.height)
  if (box.width === 0 || box.height === 0) return out

  const src = frame.data
  const dst = out.data
  const radius = 2 // 5x5 kernel

  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0

      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const sx = x + kx
          const sy = y + ky
          if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height) continue
          const i = idx(sx, sy, frame.width)
          r += src[i] ?? 0
          g += src[i + 1] ?? 0
          b += src[i + 2] ?? 0
          a += src[i + 3] ?? 0
          count++
        }
      }

      if (count > 0) {
        const i = idx(x, y, frame.width)
        dst[i] = Math.round(r / count)
        dst[i + 1] = Math.round(g / count)
        dst[i + 2] = Math.round(b / count)
        dst[i + 3] = Math.round(a / count)
      }
    }
  }

  return out
}

/**
 * Remplit la bbox avec une couleur unie (par défaut noir opaque).
 */
export function applySolidMask(
  frame: VideoFrame,
  bbox: BBox,
  color: RGBA = [0, 0, 0, 255]
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  const box = clampBBox(bbox, frame.width, frame.height)
  if (box.width === 0 || box.height === 0) return out

  const dst = out.data
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = idx(x, y, frame.width)
      dst[i] = color[0]
      dst[i + 1] = color[1]
      dst[i + 2] = color[2]
      dst[i + 3] = color[3]
    }
  }
  return out
}

/**
 * Pixelate : moyenne par bloc puis remplissage.
 */
export function applyPixelate(
  frame: VideoFrame,
  bbox: BBox,
  blockSize = 8
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  const box = clampBBox(bbox, frame.width, frame.height)
  if (box.width === 0 || box.height === 0) return out
  const step = Math.max(1, Math.floor(blockSize))

  const src = frame.data
  const dst = out.data

  for (let by = box.y; by < box.y + box.height; by += step) {
    for (let bx = box.x; bx < box.x + box.width; bx += step) {
      const blockW = Math.min(step, box.x + box.width - bx)
      const blockH = Math.min(step, box.y + box.height - by)

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0

      for (let y = by; y < by + blockH; y++) {
        for (let x = bx; x < bx + blockW; x++) {
          const i = idx(x, y, frame.width)
          r += src[i] ?? 0
          g += src[i + 1] ?? 0
          b += src[i + 2] ?? 0
          a += src[i + 3] ?? 0
          count++
        }
      }

      if (count === 0) continue
      const avgR = Math.round(r / count)
      const avgG = Math.round(g / count)
      const avgB = Math.round(b / count)
      const avgA = Math.round(a / count)

      for (let y = by; y < by + blockH; y++) {
        for (let x = bx; x < bx + blockW; x++) {
          const i = idx(x, y, frame.width)
          dst[i] = avgR
          dst[i + 1] = avgG
          dst[i + 2] = avgB
          dst[i + 3] = avgA
        }
      }
    }
  }

  return out
}

/**
 * Applique le masquage par défaut (solid black) à toutes les zones
 * pour lesquelles une bbox est définie. Les zones sans bbox sont ignorées
 * (le pipeline OCR doit fournir la bbox sinon on ne sait pas où masquer).
 */
export function sanitizeFrame(
  frame: VideoFrame,
  zones: DetectedZone[]
): VideoFrame {
  let current = frame
  for (const zone of zones) {
    if (!zone.bbox) continue
    current = applySolidMask(current, zone.bbox)
  }
  return current
}
