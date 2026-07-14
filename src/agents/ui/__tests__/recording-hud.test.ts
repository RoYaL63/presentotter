import { describe, expect, it } from 'vitest'
import { formatBytes } from '../recording-hud'

describe('formatBytes', () => {
  it('renders zero and negatives as 0 Ko', () => {
    expect(formatBytes(0)).toBe('0 Ko')
    expect(formatBytes(-5)).toBe('0 Ko')
    expect(formatBytes(Number.NaN)).toBe('0 Ko')
  })

  it('renders small sizes in Ko (never 0 Ko for real data)', () => {
    expect(formatBytes(500)).toBe('1 Ko')
    expect(formatBytes(870 * 1024)).toBe('870 Ko')
  })

  it('renders Mo with a comma decimal under 10 Mo', () => {
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12 Mo')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2,5 Mo')
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 Mo')
  })

  it('renders Go past 1024 Mo', () => {
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1,25 Go')
  })
})
