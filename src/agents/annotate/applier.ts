import type { Annotation, VideoFrame } from '../../../interfaces'
import type { Point, RGBA } from './types'
import {
  drawArrow,
  drawCircle,
  drawFreeform,
  drawRect,
  drawSpotlight,
  drawText
} from './renderer'

/**
 * Glue Annotation -> renderer.
 * `applier.ts` orchestre les fonctions de dessin selon le `type`.
 */

/**
 * Parse une couleur hex (#RRGGBB ou #RRGGBBAA) vers un tuple RGBA.
 * Si l'opacité est fournie séparément via `annotation.opacity` (0..1),
 * elle est multipliée à l'alpha extrait.
 */
export function parseHexColor(hex: string, opacity = 1): RGBA {
  const clean = hex.trim().replace(/^#/, '')
  let r = 0
  let g = 0
  let b = 0
  let a = 255

  if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16)
    g = parseInt(clean.slice(2, 4), 16)
    b = parseInt(clean.slice(4, 6), 16)
  } else if (clean.length === 8) {
    r = parseInt(clean.slice(0, 2), 16)
    g = parseInt(clean.slice(2, 4), 16)
    b = parseInt(clean.slice(4, 6), 16)
    a = parseInt(clean.slice(6, 8), 16)
  } else if (clean.length === 3) {
    // Format court #RGB.
    r = parseInt(clean[0]! + clean[0]!, 16)
    g = parseInt(clean[1]! + clean[1]!, 16)
    b = parseInt(clean[2]! + clean[2]!, 16)
  }

  // Sanity : NaN -> 0.
  r = Number.isFinite(r) ? r : 0
  g = Number.isFinite(g) ? g : 0
  b = Number.isFinite(b) ? b : 0
  a = Number.isFinite(a) ? a : 255

  const op = Math.max(0, Math.min(1, opacity))
  const finalA = Math.round(a * op)
  return [r, g, b, finalA]
}

/**
 * Applique une seule annotation à une frame.
 * Si le type est inconnu ou que les données requises manquent, retourne la frame inchangée.
 */
export function applyAnnotation(frame: VideoFrame, annotation: Annotation): VideoFrame {
  const color = parseHexColor(annotation.color, annotation.opacity)

  switch (annotation.type) {
    case 'rectangle': {
      if (!annotation.bbox) return frame
      return drawRect(frame, annotation.bbox, color)
    }
    case 'circle': {
      if (!annotation.bbox) return frame
      const center: Point = {
        x: annotation.bbox.x + annotation.bbox.width / 2,
        y: annotation.bbox.y + annotation.bbox.height / 2
      }
      const radius = Math.min(annotation.bbox.width, annotation.bbox.height) / 2
      return drawCircle(frame, center, radius, color)
    }
    case 'arrow': {
      const pts = annotation.points
      if (!pts || pts.length < 2) return frame
      const from = pts[0]!
      const to = pts[pts.length - 1]!
      return drawArrow(frame, from, to, color)
    }
    case 'freeform': {
      const pts = annotation.points
      if (!pts || pts.length === 0) return frame
      return drawFreeform(frame, pts, color)
    }
    case 'text': {
      if (!annotation.bbox || !annotation.text) return frame
      const position: Point = { x: annotation.bbox.x, y: annotation.bbox.y }
      const size = annotation.bbox.height > 0 ? annotation.bbox.height : 16
      return drawText(frame, position, annotation.text, color, size)
    }
    case 'spotlight': {
      if (!annotation.bbox) return frame
      const center: Point = {
        x: annotation.bbox.x + annotation.bbox.width / 2,
        y: annotation.bbox.y + annotation.bbox.height / 2
      }
      const radius = Math.min(annotation.bbox.width, annotation.bbox.height) / 2
      // L'opacité de l'annotation contrôle l'intensité du dimming.
      return drawSpotlight(frame, center, radius, annotation.opacity)
    }
    default:
      return frame
  }
}

/**
 * Filtre les annotations actives à `frameIndex` et les applique en pipeline.
 * Une annotation est active si `startFrame <= frameIndex <= endFrame`.
 * L'ordre du pipeline suit l'ordre du tableau (premier ajouté = dessous).
 */
export function applyAnnotationsAtFrame(
  frame: VideoFrame,
  frameIndex: number,
  annotations: Annotation[]
): VideoFrame {
  let current = frame
  for (const annotation of annotations) {
    if (frameIndex < annotation.startFrame || frameIndex > annotation.endFrame) continue
    current = applyAnnotation(current, annotation)
  }
  return current
}
