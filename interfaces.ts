// ============================================================================
// CORE TYPES — PresentOtter
// ============================================================================

// Capture Agent Types
export interface CaptureConfig {
  source: 'screen' | 'region' | 'window'
  width: number
  height: number
  fps: 30 | 60
  audioInputs: {
    system: boolean
    microphone: boolean
  }
  audioDeviceId?: string
}

export interface VideoFrame {
  data: Buffer
  width: number
  height: number
  timestamp: number
  format: 'rgba' | 'yuv420'
}

export interface RawRecording {
  id: string
  frames: VideoFrame[]
  audioData: Buffer
  duration: number
  config: CaptureConfig
  bookmarks: Array<{ frameIndex: number; timestamp: number; label?: string }>
  createdAt: Date
}

// Sanitizer Agent Types
export interface SanitizePattern {
  name: string
  regex: RegExp
  replacement: string
  confidence: number
}

export interface DetectedZone {
  type: 'api-key' | 'bearer-token' | 'jwt' | 'env-var' | 'credit-card' | 'credential'
  pattern: string
  frameIndices: number[]
  confidence: number
  bbox?: { x: number; y: number; width: number; height: number }
}

export interface SanitizeReport {
  recordingId: string
  totalFrames: number
  zonesDetected: DetectedZone[]
  patternMatches: Array<{ pattern: string; count: number }>
  analyzedAt: Date
}

export interface SanitizedRecording extends RawRecording {
  sanitizeReport: SanitizeReport
  maskedFrames: VideoFrame[]
}

// Export Agent Types
export type ExportFormat = 'mp4' | 'webm' | 'gif'

export interface ExportPreset {
  name: string
  codec: string
  bitrate: string
  scale?: string
  fps?: number
}

export interface ExportConfig {
  format: ExportFormat
  quality: 'low' | 'medium' | 'high' | 'lossless'
  preset?: ExportPreset
  outputPath: string
}

export interface ExportProgress {
  recordingId: string
  currentFrame: number
  totalFrames: number
  percent: number
  eta: number
  speed: number
}

// Library Agent Types
export interface RecordingLibraryEntry {
  id: string
  name: string
  duration: number
  createdAt: Date
  updatedAt: Date
  filePath?: string
  format?: ExportFormat
  fileSize?: number
  sanitized: boolean
  tags: string[]
  thumbnailPath?: string
}

// UI Agent Types
export interface UIState {
  isRecording: boolean
  recordingTime: number
  annotationMode: 'off' | 'draw' | 'text' | 'shapes' | 'spotlight'
  recordings: RecordingLibraryEntry[]
}

// Annotation Types
export type AnnotationType = 'freeform' | 'rectangle' | 'circle' | 'arrow' | 'text' | 'spotlight'

export interface Annotation {
  id: string
  type: AnnotationType
  color: string
  opacity: number
  startFrame: number
  endFrame: number
  points?: Array<{ x: number; y: number }>
  text?: string
  bbox?: { x: number; y: number; width: number; height: number }
}

// Session Management
export interface CaptureSession {
  id: string
  config: CaptureConfig
  startedAt: Date
  endedAt?: Date
  status: 'active' | 'paused' | 'stopped'
  rawRecording?: RawRecording
  annotations: Annotation[]
}

// Error Handling
export class PresentOtterError extends Error {
  constructor(
    public code: string,
    public message: string,
    public recoverable: boolean = false
  ) {
    super(message)
    this.name = 'PresentOtterError'
  }
}
