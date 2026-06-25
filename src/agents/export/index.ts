export { VideoEncoder } from './encoder'
export type { VideoEncoderDeps, FileStatProvider } from './encoder'

export { MockFfmpegAdapter, MockJob } from './mock-ffmpeg-adapter'
export type { MockFfmpegAdapterOptions, MockJobCall } from './mock-ffmpeg-adapter'

export { createFluentFfmpegAdapter } from './ffmpeg-adapter'
export type {
  FfmpegAdapter,
  FfmpegJob,
  FfmpegOptions,
  FfmpegProgressEvent
} from './ffmpeg-adapter'

export { PRESETS, getPresetForFormat } from './presets'

export { buildWatermarkFilter } from './watermark'
export type { WatermarkConfig, WatermarkPosition } from './watermark'
