import { describe, it, expect } from 'vitest'
import { CursorTracker } from '../cursor-tracker'

describe('CursorTracker', () => {
  it('records positions and returns them via getTrail / getHighlight', () => {
    const t = new CursorTracker(10)
    t.record({ x: 1, y: 2 }, 0)
    t.record({ x: 3, y: 4 }, 1)
    t.record({ x: 5, y: 6 }, 2)
    expect(t.getTrail()).toHaveLength(3)
    expect(t.getHighlight()).toEqual({ x: 5, y: 6 })
  })

  it('behaves as a ring buffer past its capacity', () => {
    const t = new CursorTracker(3)
    t.record({ x: 0, y: 0 }, 0)
    t.record({ x: 1, y: 1 }, 1)
    t.record({ x: 2, y: 2 }, 2)
    t.record({ x: 3, y: 3 }, 3) // évince la position 0
    const trail = t.getTrail()
    expect(trail).toHaveLength(3)
    expect(trail[0]?.frameIndex).toBe(1)
    expect(trail[2]?.frameIndex).toBe(3)
  })

  it('clear empties the buffer and getHighlight returns null', () => {
    const t = new CursorTracker(5)
    t.record({ x: 1, y: 1 }, 0)
    t.clear()
    expect(t.getTrail()).toEqual([])
    expect(t.getHighlight()).toBeNull()
  })
})
