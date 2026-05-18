import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LibraryManager } from '../library-manager'
import { RecordingDatabase } from '../database'
import { RecordingStorage } from '../storage'
import { MockThumbnailGenerator } from '../thumbnail-generator'
import { InMemoryAdapter } from '../in-memory-adapter'
import type { FileSystemAdapter } from '../storage'
import { eventBus } from '../../../../event-bus'

function makeFsMock(): FileSystemAdapter {
  return {
    existsSync: vi.fn().mockReturnValue(false),
    unlinkSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(Buffer.alloc(0))
  }
}

describe('LibraryManager', () => {
  let manager: LibraryManager
  let db: RecordingDatabase

  beforeEach(() => {
    const adapter = new InMemoryAdapter()
    db = new RecordingDatabase(adapter)
    const fs = makeFsMock()
    const storage = new RecordingStorage(fs, '/recordings')
    const thumbnailGen = new MockThumbnailGenerator(fs)
    manager = new LibraryManager({ db, storage, thumbnailGen })
  })

  it('creates an entry in the DB on export:complete', () => {
    expect(db.findAll()).toHaveLength(0)
    eventBus.emit('export:complete', {
      outputPath: '/recordings/demo-export.mp4',
      fileSize: 4_200_000,
      duration: 12_500
    })
    const all = db.findAll()
    expect(all).toHaveLength(1)
    const entry = all[0]
    expect(entry?.name).toBe('demo-export')
    expect(entry?.filePath).toBe('/recordings/demo-export.mp4')
    expect(entry?.fileSize).toBe(4_200_000)
    expect(entry?.duration).toBe(12_500)
    expect(entry?.format).toBe('mp4')
    manager.dispose()
  })

  it('defaults sanitized = false on a fresh export entry', () => {
    eventBus.emit('export:complete', {
      outputPath: '/recordings/another.webm',
      fileSize: 1024,
      duration: 5000
    })
    const all = db.findAll()
    expect(all).toHaveLength(1)
    expect(all[0]?.sanitized).toBe(false)
    expect(all[0]?.format).toBe('webm')
    expect(all[0]?.tags).toEqual([])
    manager.dispose()
  })
})
