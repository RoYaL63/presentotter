import { describe, it, expect } from 'vitest'
import {
  drawArrow,
  drawCircle,
  drawFreeform,
  drawRect,
  drawSpotlight,
  drawText
} from '../renderer'
import type { VideoFrame } from '../../../../interfaces'
import type { RGBA } from '../types'

const W = 20
const H = 20
const CHANNELS = 4

function whiteFrame(): VideoFrame {
  const data = Buffer.alloc(W * H * CHANNELS, 255)
  return { data, width: W, height: H, timestamp: 0, format: 'rgba' }
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

const RED: RGBA = [255, 0, 0, 255]

describe('drawRect', () => {
  it('paints the border and leaves the inside untouched', () => {
    const frame = whiteFrame()
    const out = drawRect(frame, { x: 4, y: 4, width: 6, height: 6 }, RED, 1)

    // Coin top-left du contour : rouge.
    expect(pixelAt(out, 4, 4)).toEqual([255, 0, 0, 255])
    // Pixel intérieur du rectangle : doit rester blanc.
    expect(pixelAt(out, 6, 6)).toEqual([255, 255, 255, 255])
    // Pixel extérieur : blanc.
    expect(pixelAt(out, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('does not mutate the source buffer', () => {
    const frame = whiteFrame()
    const original = Buffer.from(frame.data)
    drawRect(frame, { x: 2, y: 2, width: 5, height: 5 }, RED, 1)
    expect(Buffer.compare(frame.data, original)).toBe(0)
  })

  it('clamps a bbox that goes off-frame without crashing', () => {
    const frame = whiteFrame()
    expect(() =>
      drawRect(frame, { x: 18, y: 18, width: 50, height: 50 }, RED, 2)
    ).not.toThrow()
    const out = drawRect(frame, { x: 18, y: 18, width: 50, height: 50 }, RED, 2)
    // Le buffer doit avoir la taille originale.
    expect(out.data.length).toBe(W * H * CHANNELS)
  })
})

describe('drawCircle', () => {
  it('has approximate symmetry across the 4 quadrants', () => {
    const frame = whiteFrame()
    const center = { x: 10, y: 10 }
    const r = 5
    const out = drawCircle(frame, center, r, RED, 1)

    // 4 points cardinaux : doivent tous être rouges.
    expect(pixelAt(out, 10 + r, 10)[0]).toBe(255) // East
    expect(pixelAt(out, 10 - r, 10)[0]).toBe(255) // West
    expect(pixelAt(out, 10, 10 + r)[0]).toBe(255) // South
    expect(pixelAt(out, 10, 10 - r)[0]).toBe(255) // North
  })

  it('does not crash on radius <= 0', () => {
    const frame = whiteFrame()
    expect(() => drawCircle(frame, { x: 10, y: 10 }, 0, RED, 1)).not.toThrow()
    expect(() => drawCircle(frame, { x: 10, y: 10 }, -3, RED, 1)).not.toThrow()
  })
})

describe('drawArrow', () => {
  it('modifies pixels along the from→to line', () => {
    const frame = whiteFrame()
    const out = drawArrow(frame, { x: 2, y: 10 }, { x: 15, y: 10 }, RED, 1)
    // Un pixel au milieu de la ligne doit être rouge.
    const mid = pixelAt(out, 8, 10)
    expect(mid[0]).toBe(255)
    expect(mid[1]).toBe(0)
  })
})

describe('drawFreeform', () => {
  it('draws segments through all provided points', () => {
    const frame = whiteFrame()
    const out = drawFreeform(
      frame,
      [
        { x: 2, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: 10 }
      ],
      RED,
      1
    )
    // Aux 3 points : rouge.
    expect(pixelAt(out, 2, 2)[0]).toBe(255)
    expect(pixelAt(out, 10, 2)[0]).toBe(255)
    expect(pixelAt(out, 10, 10)[0]).toBe(255)
  })

  it('handles an empty point list without crashing', () => {
    const frame = whiteFrame()
    const out = drawFreeform(frame, [], RED, 1)
    expect(out.data.length).toBe(frame.data.length)
  })
})

describe('drawText (stub P0)', () => {
  it('paints a placeholder rectangle at position (real glyphs deferred to Phase 3)', () => {
    const frame = whiteFrame()
    const out = drawText(frame, { x: 5, y: 5 }, 'hi', RED, 4)
    // Au moins un pixel autour de la position doit avoir été modifié.
    expect(pixelAt(out, 5, 5)[0]).toBe(255)
    expect(pixelAt(out, 5, 5)[1]).toBe(0)
  })
})

describe('drawSpotlight', () => {
  it('dims pixels outside the disc and leaves the inside untouched', () => {
    const frame = whiteFrame()
    const out = drawSpotlight(frame, { x: 10, y: 10 }, 3, 0.6)
    // Inside (centre) : reste blanc.
    expect(pixelAt(out, 10, 10)[0]).toBe(255)
    // Outside (coin) : assombri à ~40%.
    const corner = pixelAt(out, 0, 0)
    expect(corner[0]).toBeLessThan(255)
    expect(corner[0]).toBeGreaterThan(50)
  })
})
