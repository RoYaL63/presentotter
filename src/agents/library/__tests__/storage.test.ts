import { describe, it, expect, vi } from 'vitest'
import { RecordingStorage } from '../storage'
import type { FileSystemAdapter } from '../storage'

function makeFsMock(overrides: Partial<FileSystemAdapter> = {}): FileSystemAdapter {
  return {
    existsSync: vi.fn().mockReturnValue(false),
    unlinkSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(Buffer.alloc(0)),
    ...overrides
  }
}

describe('RecordingStorage', () => {
  it('delete removes file if it exists', () => {
    const fs = makeFsMock({ existsSync: vi.fn().mockReturnValue(true) })
    const storage = new RecordingStorage(fs, '/recordings')
    const ok = storage.delete('/recordings/foo.mp4')
    expect(ok).toBe(true)
    expect(fs.unlinkSync).toHaveBeenCalledWith('/recordings/foo.mp4')
  })

  it('move calls renameSync when source exists', () => {
    const fs = makeFsMock({ existsSync: vi.fn().mockReturnValue(true) })
    const storage = new RecordingStorage(fs, '/recordings')
    const ok = storage.move('/a.mp4', '/b.mp4')
    expect(ok).toBe(true)
    expect(fs.renameSync).toHaveBeenCalledWith('/a.mp4', '/b.mp4')
  })

  it('ensureRecordingsDir creates dir recursively when missing', () => {
    const fs = makeFsMock({ existsSync: vi.fn().mockReturnValue(false) })
    const storage = new RecordingStorage(fs, '/data/recordings')
    storage.ensureRecordingsDir()
    expect(fs.mkdirSync).toHaveBeenCalledWith('/data/recordings', { recursive: true })
  })
})
