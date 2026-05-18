import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, Pause, Play, Square } from 'lucide-react'
import { eventBus } from '@event-bus'
import { useRecordingStore } from '../stores/useRecordingStore'
import { useNavStore } from '../stores/useNavStore'
import { AnnotationToolbar } from '../components/AnnotationToolbar'
import { VideoPreview } from '../components/VideoPreview'

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
  const pauseRecording = useRecordingStore((s) => s.pauseRecording)
  const resumeRecording = useRecordingStore((s) => s.resumeRecording)
  const stopRecording = useRecordingStore((s) => s.stopRecording)
  const tick = useRecordingStore((s) => s.tick)
  const navigate = useNavStore((s) => s.navigate)

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
    eventBus.emit('capture:bookmark', {
      frameIndex: 0,
      timestamp: Date.now(),
      label: `Bookmark @ ${formatElapsed(elapsed)}`
    })
  }

  const handleStop = () => {
    stopRecording()
    navigate('preview')
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.span
            className="inline-block h-3 w-3 rounded-full bg-red-500"
            animate={
              isRecording && !isPaused
                ? { opacity: [1, 0.3, 1], scale: [1, 1.2, 1] }
                : { opacity: 0.5, scale: 1 }
            }
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
          <span className="text-sm font-medium uppercase tracking-wider text-slate-300">
            {isPaused ? 'En pause' : isRecording ? 'Enregistrement' : 'Inactif'}
          </span>
        </div>
        <div className="font-mono text-3xl text-slate-100 tabular-nums" aria-live="polite">
          {formatElapsed(elapsed)}
        </div>
      </header>

      <VideoPreview label="Capture en cours" />

      <AnnotationToolbar />

      <div className="flex items-center justify-center gap-3">
        {isPaused ? (
          <button
            type="button"
            onClick={resumeRecording}
            className="flex items-center gap-2 rounded-lg bg-otter-600 px-4 py-2 text-sm font-medium text-white hover:bg-otter-500"
          >
            <Play className="h-4 w-4" />
            <span>Reprendre</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={pauseRecording}
            disabled={!isRecording}
            className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50"
          >
            <Pause className="h-4 w-4" />
            <span>Pause</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleBookmark}
          disabled={!isRecording}
          className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50"
        >
          <Bookmark className="h-4 w-4" />
          <span>Bookmark</span>
        </button>

        <button
          type="button"
          onClick={handleStop}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          <Square className="h-4 w-4" fill="currentColor" />
          <span>Arrêter</span>
        </button>
      </div>
    </section>
  )
}
