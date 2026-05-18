import { describe, it, expect, beforeEach } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { VideoEncoder } from '../encoder'
import { MockFfmpegAdapter } from '../mock-ffmpeg-adapter'
import { eventBus } from '../../../../event-bus'
import type { RawRecording, ExportConfig, VideoFrame } from '../../../../interfaces'

function makeFrame(): VideoFrame {
  return {
    data: Buffer.alloc(16),
    width: 2,
    height: 2,
    timestamp: 0,
    format: 'rgba'
  }
}

function makeRecording(): RawRecording {
  return {
    id: 'rec-encode-1',
    frames: [makeFrame(), makeFrame(), makeFrame()],
    audioData: Buffer.alloc(0),
    duration: 100,
    config: {
      source: 'screen',
      width: 2,
      height: 2,
      fps: 30,
      audioInputs: { system: true, microphone: false }
    },
    bookmarks: [],
    createdAt: new Date()
  }
}

const baseConfig = (format: ExportConfig['format'] = 'mp4'): ExportConfig => ({
  format,
  quality: 'medium',
  outputPath: `/tmp/output.${format}`
})

describe('VideoEncoder.encode', () => {
  let adapter: MockFfmpegAdapter
  let encoder: VideoEncoder

  beforeEach(() => {
    adapter = new MockFfmpegAdapter()
    encoder = new VideoEncoder({ adapter, fileStatProvider: () => 4096 })
  })

  it('emits export:started before resolving', async () => {
    const startedPromise = firstValueFrom(eventBus.on('export:started'))
    await encoder.encode(makeRecording(), baseConfig())
    const started = await startedPromise
    expect(started.recordingId).toBe('rec-encode-1')
    expect(started.config.outputPath).toBe('/tmp/output.mp4')
  })

  it('emits at least one export:progress and resolves with export:complete', async () => {
    const progressPromise = firstValueFrom(eventBus.on('export:progress'))
    const result = await encoder.encode(makeRecording(), baseConfig())
    const progress = await progressPromise
    expect(progress.percent).toBeGreaterThan(0)
    expect(result.outputPath).toBe('/tmp/output.mp4')
    expect(result.fileSize).toBe(4096)
    expect(result.duration).toBe(100)
  })

  it('rejects and emits export:error when adapter fails', async () => {
    const failingAdapter = new MockFfmpegAdapter({ shouldFail: true })
    const failingEncoder = new VideoEncoder({ adapter: failingAdapter })
    const errorPromise = firstValueFrom(eventBus.on('export:error'))
    await expect(failingEncoder.encode(makeRecording(), baseConfig())).rejects.toThrow()
    const err = await errorPromise
    expect(err.code).toBe('FFMPEG_ERROR')
  })

  it('passes the correct videoCodec to the adapter for mp4', async () => {
    await encoder.encode(makeRecording(), baseConfig('mp4'))
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]?.options.videoCodec).toBe('libx264')
  })

  it('does not set audioCodec for gif', async () => {
    await encoder.encode(makeRecording(), baseConfig('gif'))
    expect(adapter.calls[0]?.options.audioCodec).toBeUndefined()
  })

  it('respects the outputPath in the config', async () => {
    const config: ExportConfig = {
      format: 'webm',
      quality: 'medium',
      outputPath: '/custom/path/video.webm'
    }
    await encoder.encode(makeRecording(), config)
    expect(adapter.calls[0]?.outputPath).toBe('/custom/path/video.webm')
  })
})

describe('VideoEncoder.cancel', () => {
  it('emits export:cancelled', () => {
    const adapter = new MockFfmpegAdapter()
    const encoder = new VideoEncoder({ adapter })
    void encoder.encode(makeRecording(), baseConfig())
    const cancelledPromise = firstValueFrom(eventBus.on('export:cancelled'))
    encoder.cancel('rec-encode-1')
    return expect(cancelledPromise).resolves.toEqual({ recordingId: 'rec-encode-1' })
  })
})
