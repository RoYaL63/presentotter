import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { framesToConcatFileList, framesToRawVideoPipe } from '../frames-to-file'
import type { RawRecording, VideoFrame } from '../../../../interfaces'

function makeFrame(width = 4, height = 4): VideoFrame {
  return {
    data: Buffer.alloc(width * height * 4),
    width,
    height,
    timestamp: 0,
    format: 'rgba'
  }
}

function makeRecording(frameCount = 3): RawRecording {
  return {
    id: 'rec-test',
    frames: Array.from({ length: frameCount }, () => makeFrame()),
    audioData: Buffer.alloc(0),
    duration: frameCount * 33,
    config: {
      source: 'screen',
      width: 4,
      height: 4,
      fps: 30,
      audioInputs: { system: false, microphone: false }
    },
    bookmarks: [],
    createdAt: new Date()
  }
}

describe('framesToConcatFileList', () => {
  it('returns one path per frame', () => {
    const recording = makeRecording(5)
    const { framePaths } = framesToConcatFileList(recording, '/tmp/frames')
    expect(framePaths).toHaveLength(5)
  })

  it('listPath ends with .txt', () => {
    const { listPath } = framesToConcatFileList(makeRecording(1), '/tmp/frames')
    expect(listPath.endsWith('.txt')).toBe(true)
  })
})

describe('framesToRawVideoPipe', () => {
  it('returns a Readable stream', () => {
    const stream = framesToRawVideoPipe(makeRecording(2))
    expect(stream).toBeInstanceOf(Readable)
  })
})
