import { describe, it, expect } from 'vitest'
import {
  applyBlur,
  applyPixelate,
  applySolidMask,
  sanitizeFrame
} from '../masker'
import type { DetectedZone, VideoFrame } from '../../../../interfaces'

const W = 10
const H = 10
const CHANNELS = 4

/**
 * Crée une VideoFrame 10x10 RGBA remplie de 255 (blanc opaque).
 */
function whiteFrame(): VideoFrame {
  const data = Buffer.alloc(W * H * CHANNELS, 255)
  return {
    data,
    width: W,
    height: H,
    timestamp: 0,
    format: 'rgba'
  }
}

function pixelAt(frame: VideoFrame, x: number, y: number): [number, number, number, number] {
  const i = (y * frame.width + x) * CHANNELS
  return [
    frame.data[i] ?? -1,
    frame.data[i + 1] ?? -1,
    frame.data[i + 2] ?? -1,
    frame.data[i + 3] ?? -1
  ]
}

describe('applySolidMask', () => {
  it('zeros pixels inside the bbox and leaves outside untouched', () => {
    const frame = whiteFrame()
    const out = applySolidMask(frame, { x: 2, y: 2, width: 4, height: 4 })

    // Inside : doit être 0,0,0,255 (noir opaque)
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        expect(pixelAt(out, x, y)).toEqual([0, 0, 0, 255])
      }
    }

    // Outside : doit rester 255,255,255,255
    expect(pixelAt(out, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixelAt(out, 9, 9)).toEqual([255, 255, 255, 255])
    expect(pixelAt(out, 1, 5)).toEqual([255, 255, 255, 255])
    expect(pixelAt(out, 6, 2)).toEqual([255, 255, 255, 255])
  })

  it('does not mutate the source frame', () => {
    const frame = whiteFrame()
    const original = Buffer.from(frame.data)
    applySolidMask(frame, { x: 0, y: 0, width: 5, height: 5 })
    expect(Buffer.compare(frame.data, original)).toBe(0)
  })

  it('supports custom color', () => {
    const frame = whiteFrame()
    const out = applySolidMask(frame, { x: 0, y: 0, width: 2, height: 2 }, [10, 20, 30, 200])
    expect(pixelAt(out, 0, 0)).toEqual([10, 20, 30, 200])
    expect(pixelAt(out, 1, 1)).toEqual([10, 20, 30, 200])
  })

  it('clamps bbox to frame bounds', () => {
    const frame = whiteFrame()
    // bbox déborde -> on tronque, pas de crash
    const out = applySolidMask(frame, { x: 8, y: 8, width: 100, height: 100 })
    expect(pixelAt(out, 8, 8)).toEqual([0, 0, 0, 255])
    expect(pixelAt(out, 9, 9)).toEqual([0, 0, 0, 255])
  })
})

describe('applyBlur', () => {
  it('produces values different from solid mask but still bounded', () => {
    const frame = whiteFrame()
    // On met une "tache" noire au centre puis on flou
    const i = (5 * W + 5) * CHANNELS
    frame.data[i] = 0
    frame.data[i + 1] = 0
    frame.data[i + 2] = 0
    frame.data[i + 3] = 255

    const out = applyBlur(frame, { x: 3, y: 3, width: 5, height: 5 })
    const [r, g, b, a] = pixelAt(out, 5, 5)
    // Le pixel noir doit être adouci (moyenne avec voisins blancs) -> r > 0
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(255)
    expect(g).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(0)
    expect(a).toBe(255)
  })
})

describe('applyPixelate', () => {
  it('uniformizes a block of pixels', () => {
    const frame = whiteFrame()
    // Half-and-half : moitié gauche du bloc en noir, droite en blanc
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * W + x) * CHANNELS
        frame.data[i] = 0
        frame.data[i + 1] = 0
        frame.data[i + 2] = 0
        frame.data[i + 3] = 255
      }
    }
    const out = applyPixelate(frame, { x: 0, y: 0, width: 4, height: 4 }, 4)
    // Tous les pixels du bloc doivent avoir la même valeur (moyenne)
    const ref = pixelAt(out, 0, 0)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(pixelAt(out, x, y)).toEqual(ref)
      }
    }
    // Moyenne de 8 pixels noirs + 8 blancs ≈ 127
    expect(ref[0]).toBeGreaterThan(100)
    expect(ref[0]).toBeLessThan(160)
  })
})

describe('sanitizeFrame', () => {
  it('applies solid mask to all zones with bbox', () => {
    const frame = whiteFrame()
    const zones: DetectedZone[] = [
      {
        type: 'api-key',
        pattern: 'openai-api-key',
        frameIndices: [0],
        confidence: 0.98,
        bbox: { x: 0, y: 0, width: 2, height: 2 }
      },
      {
        type: 'jwt',
        pattern: 'jwt',
        frameIndices: [0],
        confidence: 0.95,
        bbox: { x: 7, y: 7, width: 2, height: 2 }
      }
    ]
    const out = sanitizeFrame(frame, zones)
    expect(pixelAt(out, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixelAt(out, 1, 1)).toEqual([0, 0, 0, 255])
    expect(pixelAt(out, 7, 7)).toEqual([0, 0, 0, 255])
    expect(pixelAt(out, 8, 8)).toEqual([0, 0, 0, 255])
    // Hors zones : intact
    expect(pixelAt(out, 4, 4)).toEqual([255, 255, 255, 255])
  })

  it('ignores zones without bbox', () => {
    const frame = whiteFrame()
    const zones: DetectedZone[] = [
      {
        type: 'api-key',
        pattern: 'openai-api-key',
        frameIndices: [0],
        confidence: 0.98
      }
    ]
    const out = sanitizeFrame(frame, zones)
    expect(Buffer.compare(out.data, frame.data)).toBe(0)
  })
})
