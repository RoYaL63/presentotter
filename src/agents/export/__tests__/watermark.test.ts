import { describe, it, expect } from 'vitest'
import { buildWatermarkFilter } from '../watermark'

describe('buildWatermarkFilter', () => {
  it('returns empty array when neither text nor image is provided', () => {
    expect(buildWatermarkFilter({ position: 'br' })).toEqual([])
  })

  it('builds a drawtext filter when text is provided', () => {
    const args = buildWatermarkFilter({ text: 'PresentOtter', position: 'tl' })
    expect(args[0]).toBe('-vf')
    expect(args[1]).toContain('drawtext')
    expect(args[1]).toContain('PresentOtter')
  })

  it('uses different coords for each position (text)', () => {
    const tl = buildWatermarkFilter({ text: 'X', position: 'tl' })[1]
    const br = buildWatermarkFilter({ text: 'X', position: 'br' })[1]
    expect(tl).not.toBe(br)
    expect(tl).toContain('x=10')
    expect(br).toContain('w-tw-10')
  })

  it('builds an overlay filter when imagePath is provided', () => {
    const args = buildWatermarkFilter({
      imagePath: '/path/to/logo.png',
      position: 'br'
    })
    expect(args).toContain('-i')
    expect(args).toContain('/path/to/logo.png')
    expect(args.some(a => a.includes('overlay'))).toBe(true)
  })

  it('respects custom fontSize and fontColor', () => {
    const args = buildWatermarkFilter({
      text: 'X',
      position: 'tl',
      fontSize: 48,
      fontColor: '#ff0000'
    })
    expect(args[1]).toContain('fontsize=48')
    expect(args[1]).toContain('fontcolor=#ff0000')
  })
})
