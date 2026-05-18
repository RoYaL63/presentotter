import type { VideoFrame } from '../../../interfaces'
import type { BBox, Point, RGBA } from './types'

/**
 * Renderer Pinceau — fonctions pures sur VideoFrame RGBA.
 *
 * Toutes les fonctions :
 *  - clonent le Buffer source (immutabilité).
 *  - clampent leurs coordonnées aux bornes (pas d'out-of-bounds).
 *  - retournent un nouveau VideoFrame.
 *
 * Inspiré du style du masker (Gardien) — pas d'import inter-agents.
 */

const CHANNELS = 4

/**
 * Index linéaire dans le buffer RGBA.
 */
function idx(x: number, y: number, width: number): number {
  return (y * width + x) * CHANNELS
}

/**
 * Clone défensif de la frame.
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
 * Vérifie qu'un pixel est dans les bornes.
 */
function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height
}

/**
 * Écrit un pixel avec compositing alpha simple (source-over).
 * alpha de la couleur 0..255 ; alpha de la frame préservé.
 */
function setPixel(
  data: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGBA
): void {
  if (!inBounds(x, y, width, height)) return
  const i = idx(x, y, width)
  const srcA = color[3] / 255
  const dstR = data[i] ?? 0
  const dstG = data[i + 1] ?? 0
  const dstB = data[i + 2] ?? 0
  const dstA = data[i + 3] ?? 0

  data[i] = Math.round(color[0] * srcA + dstR * (1 - srcA))
  data[i + 1] = Math.round(color[1] * srcA + dstG * (1 - srcA))
  data[i + 2] = Math.round(color[2] * srcA + dstB * (1 - srcA))
  data[i + 3] = Math.max(dstA, color[3])
}

/**
 * Trace un segment de ligne (DDA) avec épaisseur (bloc carré centré).
 */
function drawLineSegment(
  data: Buffer,
  width: number,
  height: number,
  from: Point,
  to: Point,
  color: RGBA,
  thickness: number
): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) || 1
  const xInc = dx / steps
  const yInc = dy / steps
  const half = Math.max(0, Math.floor((thickness - 1) / 2))

  let x = from.x
  let y = from.y
  for (let i = 0; i <= steps; i++) {
    const px = Math.round(x)
    const py = Math.round(y)
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) {
        setPixel(data, px + ox, py + oy, width, height, color)
      }
    }
    x += xInc
    y += yInc
  }
}

/**
 * Dessine un rectangle (contour seul). Épaisseur par défaut 2.
 */
export function drawRect(
  frame: VideoFrame,
  bbox: BBox,
  color: RGBA,
  thickness = 2
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  if (bbox.width <= 0 || bbox.height <= 0) return out

  const t = Math.max(1, Math.floor(thickness))
  const x0 = bbox.x
  const y0 = bbox.y
  const x1 = bbox.x + bbox.width - 1
  const y1 = bbox.y + bbox.height - 1

  // Lignes horizontales top/bottom + verticales left/right ; épaisseur = bandes.
  for (let i = 0; i < t; i++) {
    // Top
    for (let x = x0; x <= x1; x++) setPixel(out.data, x, y0 + i, out.width, out.height, color)
    // Bottom
    for (let x = x0; x <= x1; x++) setPixel(out.data, x, y1 - i, out.width, out.height, color)
    // Left
    for (let y = y0; y <= y1; y++) setPixel(out.data, x0 + i, y, out.width, out.height, color)
    // Right
    for (let y = y0; y <= y1; y++) setPixel(out.data, x1 - i, y, out.width, out.height, color)
  }

  return out
}

/**
 * Dessine un cercle (contour). Algorithme Bresenham (midpoint).
 */
export function drawCircle(
  frame: VideoFrame,
  center: Point,
  radius: number,
  color: RGBA,
  thickness = 2
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  if (radius <= 0) return out

  const t = Math.max(1, Math.floor(thickness))
  const half = Math.floor((t - 1) / 2)

  // On dessine t anneaux concentriques pour l'épaisseur.
  for (let off = -half; off <= half; off++) {
    const r = radius + off
    if (r <= 0) continue
    let x = r
    let y = 0
    let err = 0

    while (x >= y) {
      const cx = Math.round(center.x)
      const cy = Math.round(center.y)
      setPixel(out.data, cx + x, cy + y, out.width, out.height, color)
      setPixel(out.data, cx + y, cy + x, out.width, out.height, color)
      setPixel(out.data, cx - y, cy + x, out.width, out.height, color)
      setPixel(out.data, cx - x, cy + y, out.width, out.height, color)
      setPixel(out.data, cx - x, cy - y, out.width, out.height, color)
      setPixel(out.data, cx - y, cy - x, out.width, out.height, color)
      setPixel(out.data, cx + y, cy - x, out.width, out.height, color)
      setPixel(out.data, cx + x, cy - y, out.width, out.height, color)

      y++
      err += 1 + 2 * y
      if (2 * (err - x) + 1 > 0) {
        x--
        err += 1 - 2 * x
      }
    }
  }

  return out
}

/**
 * Dessine une flèche : ligne `from -> to` + pointe triangulaire à `to`.
 */
export function drawArrow(
  frame: VideoFrame,
  from: Point,
  to: Point,
  color: RGBA,
  thickness = 2
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  const t = Math.max(1, Math.floor(thickness))

  // Ligne principale.
  drawLineSegment(out.data, out.width, out.height, from, to, color, t)

  // Pointe de flèche : deux segments à ±150° de la direction.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const headLen = Math.max(6, t * 3)
  const angle = Math.atan2(dy, dx)
  const a1 = angle + Math.PI - Math.PI / 6
  const a2 = angle + Math.PI + Math.PI / 6
  const p1: Point = {
    x: to.x + Math.cos(a1) * headLen,
    y: to.y + Math.sin(a1) * headLen
  }
  const p2: Point = {
    x: to.x + Math.cos(a2) * headLen,
    y: to.y + Math.sin(a2) * headLen
  }
  // len est utilisé pour s'assurer qu'on a une direction valide.
  if (len > 0) {
    drawLineSegment(out.data, out.width, out.height, to, p1, color, t)
    drawLineSegment(out.data, out.width, out.height, to, p2, color, t)
  }

  return out
}

/**
 * Trait passant par tous les points (segments DDA).
 */
export function drawFreeform(
  frame: VideoFrame,
  points: Point[],
  color: RGBA,
  thickness = 2
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  if (points.length === 0) return out
  const t = Math.max(1, Math.floor(thickness))

  if (points.length === 1) {
    const p = points[0]
    if (p) setPixel(out.data, Math.round(p.x), Math.round(p.y), out.width, out.height, color)
    return out
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (!a || !b) continue
    drawLineSegment(out.data, out.width, out.height, a, b, color, t)
  }

  return out
}

/**
 * STUB P0 — Dessine un rectangle plein indicatif à la place du texte.
 *
 * Le vrai rendu de glyphs viendra en Phase 3 avec une lib font
 * (canvas/node-canvas ou opentype.js). Pour P0, on matérialise
 * l'emplacement du texte par un rectangle de couleur :
 *  - largeur ≈ `text.length * size * 0.6`
 *  - hauteur ≈ `size`
 * Cela permet aux tests visuels d'identifier où le texte ira.
 */
export function drawText(
  frame: VideoFrame,
  position: Point,
  text: string,
  color: RGBA,
  size = 16
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  if (text.length === 0) return out

  const w = Math.max(1, Math.round(text.length * size * 0.6))
  const h = Math.max(1, Math.round(size))
  const x0 = Math.round(position.x)
  const y0 = Math.round(position.y)

  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixel(out.data, x, y, out.width, out.height, color)
    }
  }
  return out
}

/**
 * Spotlight : assombrit toute la frame sauf un disque autour de `center`.
 * `dimAlpha` ∈ [0, 1] — proportion de noir mixé hors disque (0 = rien, 1 = noir).
 */
export function drawSpotlight(
  frame: VideoFrame,
  center: Point,
  radius: number,
  dimAlpha = 0.6
): VideoFrame {
  if (frame.format !== 'rgba') return frame
  const out = cloneFrame(frame)
  if (radius <= 0) return out
  const alpha = Math.max(0, Math.min(1, dimAlpha))
  const r2 = radius * radius
  const cx = center.x
  const cy = center.y
  const data = out.data

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) continue
      const i = idx(x, y, out.width)
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      data[i] = Math.round(r * (1 - alpha))
      data[i + 1] = Math.round(g * (1 - alpha))
      data[i + 2] = Math.round(b * (1 - alpha))
      // Alpha laissé inchangé.
    }
  }

  return out
}
