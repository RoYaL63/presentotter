import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, Pause, Play, Square } from 'lucide-react'
import { useRecordingStore } from '../stores/useRecordingStore'
import { useNavStore } from '../stores/useNavStore'
import { AnnotationToolbar } from '../components/AnnotationToolbar'
import { VideoPreview } from '../components/VideoPreview'
import { orchestrator } from '../orchestrator'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function Recording() {
  const isRecording = useRecordingStore((s) => s.isRecording)
  const isPaused = useRecordingStore((s) => s.isPaused)
  const elapsed = useRecordingStore((s) => s.elapsed)
  const sessionId = useRecordingStore((s) => s.sessionId)
  const tick = useRecordingStore((s) => s.tick)
  const navigate = useNavStore((s) => s.navigate)

  const handlePause = () => orchestrator.pauseCapture()
  const handleResume = () => orchestrator.resumeCapture()

  useEffect(() => {
    if (!isRecording || isPaused) return
    const start = Date.now() - elapsed
    const interval = window.setInterval(() => {
      tick(Date.now() - start)
    }, 200)
    return () => window.clearInterval(interval)
  }, [isRecording, isPaused, elapsed, tick])

  const handleBookmark = () => {
    if (!sessionId) return
    orchestrator.addBookmark(`Bookmark @ ${formatElapsed(elapsed)}`)
  }

  const handleStop = async () => {
    await orchestrator.stopCapture()
    navigate('preview')
  }

  const statusLabel = isPaused ? 'En pause' : isRecording ? 'Enregistrement' : 'Inactif'

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8 lg:p-12">
      {/* Status bar — glass panel with live indicator and timer */}
      <header className="glass glass-shine flex items-center justify-between rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-3 w-3">
            {isRecording && !isPaused && (
              <motion.span
                className="absolute inset-0 rounded-full bg-red-500"
                animate={{ scale: [1, 1.8], opacity: [0.7, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                aria-hidden
              />
            )}
            <span
              className={`relative h-3 w-3 rounded-full ${
                isRecording && !isPaused
                  ? 'bg-red-500 shadow-glow-red'
                  : isPaused
                    ? 'bg-fur-400'
                    : 'bg-otter-700'
              }`}
            />
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-otter-200">
            {statusLabel}
          </span>
        </div>
        <div
          className="font-mono text-3xl font-semibold text-otter-50 tabular-nums tracking-tight"
          aria-live="polite"
        >
          {formatElapsed(elapsed)}
        </div>
      </header>

      <VideoPreview label="Capture en cours" />

      <AnnotationToolbar />

      {/* Action bar */}
      <div className="flex items-center justify-center gap-3 pt-2">
        {isPaused ? (
          <button type="button" onClick={handleResume} className="btn-otter">
            <Play className="h-4 w-4" />
            <span>Reprendre</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePause}
            disabled={!isRecording}
            className="btn-glass"
          >
            <Pause className="h-4 w-4" />
            <span>Pause</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleBookmark}
          disabled={!isRecording}
          className="btn-glass"
        >
          <Bookmark className="h-4 w-4" />
          <span>Bookmark</span>
        </button>

        <button type="button" onClick={handleStop} className="btn-danger">
          <Square className="h-4 w-4" fill="currentColor" />
          <span>Arrêter</span>
        </button>
      </div>
    </section>
  )
}
