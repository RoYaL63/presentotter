import { describe, it, expect, vi } from 'vitest'
import { MockThumbnailGenerator } from '../thumbnail-generator'
import type { FileSystemAdapter } from '../storage'

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

describe('MockThumbnailGenerator', () => {
  it('generate returns the requested outputPath and writes a stub file', async () => {
    const fs = makeFsMock()
    const gen = new MockThumbnailGenerator(fs)
    const result = await gen.generate('/in/video.mp4', '/out/thumb.png', 0.5)
    expect(result).toBe('/out/thumb.png')
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    expect(fs.writeFileSync).toHaveBeenCalledWith('/out/thumb.png', expect.any(Buffer))
  })
})
