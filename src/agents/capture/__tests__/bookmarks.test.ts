import { describe, it, expect } from 'vitest'
import { BookmarkTracker } from '../bookmarks'

describe('BookmarkTracker', () => {
  it('adds bookmarks and exposes them in insertion order', () => {
    const tracker = new BookmarkTracker()
    tracker.add(0, 'intro')
    tracker.add(42, 'mid')
    tracker.add(100)

    const all = tracker.getAll()
    expect(all.length).toBe(3)
    expect(all[0].frameIndex).toBe(0)
    expect(all[0].label).toBe('intro')
    expect(all[1].frameIndex).toBe(42)
    expect(all[1].label).toBe('mid')
    expect(all[2].frameIndex).toBe(100)
    expect(all[2].label).toBeUndefined()
  })

  it('clear empties the tracker', () => {
    const tracker = new BookmarkTracker()
    tracker.add(1)
    tracker.add(2)
    expect(tracker.size()).toBe(2)

    tracker.clear()
    expect(tracker.size()).toBe(0)
    expect(tracker.getAll()).toEqual([])
  })

  it('getAll returns a defensive copy', () => {
    const tracker = new BookmarkTracker()
    tracker.add(1, 'a')
    const snapshot = tracker.getAll()
    snapshot[0].label = 'mutated'
    expect(tracker.getAll()[0].label).toBe('a')
  })
})
