/**
 * Types locaux pour l'agent Pinceau.
 * Tous les types partagés inter-agents vivent dans interfaces.ts ;
 * ce fichier ne contient que les types internes au renderer.
 */

/**
 * Point 2D en coordonnées pixel (origine top-left).
 */
export interface Point {
  x: number
  y: number
}

/**
 * Couleur RGBA — composants 0..255 chacun (alpha inclus).
 */
export type RGBA = readonly [number, number, number, number]

/**
 * Bounding box pixel-aligned.
 * Aligné sur Annotation.bbox dans interfaces.ts.
 */
export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Entrée d'historique pour CursorTracker.
 */
export interface CursorSample {
  position: Point
  frameIndex: number
}
