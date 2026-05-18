import { describe, it, expect } from 'vitest'
import { applyAnnotation, applyAnnotationsAtFrame, parseHexColor } from '../applier'
import type { Annotation, VideoFrame } from '../../../../interfaces'

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

describe('parseHexColor', () => {
  it('parses #RRGGBB and #RRGGBBAA formats', () => {
    expect(parseHexColor('#FF0000')).toEqual([255, 0, 0, 255])
    expect(parseHexColor('#00FF0080')).toEqual([0, 255, 0, 128])
    // Le multiplicateur d'opacité s'applique sur le canal alpha.
    expect(parseHexColor('#FF0000', 0.5)[3]).toBe(128)
  })
})

describe('applyAnnotationsAtFrame', () => {
  it('filters annotations whose range does not include the frame index', () => {
    const inactive: Annotation = {
      id: 'a1',
      type: 'rectangle',
      color: '#FF0000',
      opacity: 1,
      startFrame: 100,
      endFrame: 200,
      bbox: { x: 2, y: 2, width: 5, height: 5 }
    }
    const out = applyAnnotationsAtFrame(whiteFrame(), 50, [inactive])
    // Le rectangle hors range ne doit rien dessiner.
    expect(pixelAt(out, 2, 2)).toEqual([255, 255, 255, 255])
  })

  it('applies annotations in the order of the array (pipeline)', () => {
    const first: Annotation = {
      id: 'r1',
      type: 'rectangle',
      color: '#FF0000',
      opacity: 1,
      startFrame: 0,
      endFrame: 100,
      bbox: { x: 2, y: 2, width: 6, height: 6 }
    }
    const second: Annotation = {
      id: 'r2',
      type: 'rectangle',
      color: '#0000FF',
      opacity: 1,
      startFrame: 0,
      endFrame: 100,
      bbox: { x: 2, y: 2, width: 6, height: 6 }
    }
    // Le second (bleu) doit recouvrir le premier (rouge) aux mêmes pixels.
    const out = applyAnnotationsAtFrame(whiteFrame(), 10, [first, second])
    expect(pixelAt(out, 2, 2)[2]).toBe(255) // canal B = 255 (bleu dessus)
  })
})

describe('applyAnnotation', () => {
  it('returns the frame unchanged if required fields are missing', () => {
    const ann: Annotation = {
      id: 'x',
      type: 'rectangle',
      color: '#FF0000',
      opacity: 1,
      startFrame: 0,
      endFrame: 10
      // bbox absent : la fonction doit retourner la frame telle quelle.
    }
    const frame = whiteFrame()
    const out = applyAnnotation(frame, ann)
    expect(Buffer.compare(out.data, frame.data)).toBe(0)
  })
})
