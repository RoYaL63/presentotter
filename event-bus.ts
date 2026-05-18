import { Subject, Observable, filter, map } from 'rxjs'
import type {
  CaptureConfig,
  VideoFrame,
  RawRecording,
  SanitizeReport,
  SanitizedRecording,
  ExportConfig,
  DetectedZone
} from './interfaces'

type EventMap = {
  // Capture Events
  'capture:started': { sessionId: string; config: CaptureConfig; timestamp: number }
  'capture:frame': { frame: VideoFrame; timestamp: number; frameIndex: number }
  'capture:paused': { sessionId: string; elapsed: number }
  'capture:resumed': { sessionId: string }
  'capture:stopped': { sessionId: string; rawRecording: RawRecording }
  'capture:bookmark': { frameIndex: number; timestamp: number; label?: string }
  'capture:error': { code: string; message: string; recoverable: boolean }

  // Sanitizer Events
  'sanitizer:analysis-started': { recordingId: string; frameCount: number }
  'sanitizer:progress': { percent: number; zonesFound: number }
  'sanitizer:analysis-complete': { report: SanitizeReport; detectedZones: DetectedZone[] }
  'sanitizer:applied': { sanitizedRecording: SanitizedRecording }
  'sanitizer:error': { code: string; message: string }

  // Export Events
  'export:started': { recordingId: string; config: ExportConfig }
  'export:progress': { percent: number; eta: number; currentFrame: number }
  'export:complete': { outputPath: string; fileSize: number; duration: number }
  'export:cancelled': { recordingId: string }
  'export:error': { code: string; message: string }

  // Library Events
  'library:recording-deleted': { id: string }
  'library:recording-renamed': { id: string; newName: string }
  'library:recording-tagged': { id: string; tags: string[] }

  // Annotation Events
  'annotation:added': { annotationId: string; frameIndex: number }
  'annotation:removed': { annotationId: string }
  'annotation:updated': { annotationId: string }

  // UI Events
  'ui:mode-changed': { newMode: string }
  'ui:settings-updated': { key: string; value: unknown }
}

class EventBus {
  private subject = new Subject<{ type: string; payload: unknown }>()

  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void {
    this.subject.next({ type, payload })
  }

  on<K extends keyof EventMap>(type: K): Observable<EventMap[K]> {
    return this.subject.pipe(
      filter(e => e.type === type),
      map(e => e.payload as EventMap[K])
    )
  }
}

export const eventBus = new EventBus()
