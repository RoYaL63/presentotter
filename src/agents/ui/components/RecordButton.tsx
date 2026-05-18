import { motion } from 'framer-motion'
import { Circle, Square } from 'lucide-react'
import { useRecordingStore } from '../stores/useRecordingStore'

interface RecordButtonProps {
  onStart: () => void
  onStop: () => void
  disabled?: boolean
}

export function RecordButton({ onStart, onStop, disabled = false }: RecordButtonProps) {
  const isRecording = useRecordingStore((s) => s.isRecording)

  const handleClick = () => {
    if (disabled) return
    if (isRecording) onStop()
    else onStart()
  }

  return (
    <div className="relative isolate inline-flex">
      {/* Pulsing halo behind the button when recording */}
      {isRecording && (
        <>
          <motion.span
            className="absolute inset-0 -z-10 rounded-full bg-red-500/30 blur-2xl"
            animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0.2, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
          <motion.span
            className="absolute inset-0 -z-10 rounded-full ring-2 ring-red-400/60"
            animate={{ scale: [1, 1.6, 1], opacity: [0.8, 0, 0.8] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
            aria-hidden
          />
        </>
      )}

      {/* Idle glow halo — soft otter glow */}
      {!isRecording && !disabled && (
        <motion.span
          className="absolute inset-0 -z-10 rounded-full bg-otter-400/25 blur-2xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        />
      )}

      <motion.button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={isRecording ? "Arrêter l'enregistrement" : "Démarrer l'enregistrement"}
        {...(disabled ? {} : { whileHover: { scale: 1.05 }, whileTap: { scale: 0.95 } })}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        className={`group relative flex h-28 w-28 items-center justify-center rounded-full transition-all duration-300
          ${disabled
            ? 'cursor-not-allowed bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] opacity-50'
            : isRecording
              ? 'bg-gradient-to-br from-red-500 to-red-700 shadow-glow-red ring-1 ring-red-400/50 backdrop-blur-2xl'
              : 'bg-gradient-to-br from-red-500/90 to-red-700/90 backdrop-blur-2xl border border-white/[0.15] shadow-glass-lg ring-1 ring-red-400/30 hover:ring-red-300/50'}
        `}
      >
        {/* Glass shine overlay */}
        <span
          className="absolute inset-1 rounded-full bg-gradient-to-b from-white/30 via-white/5 to-transparent opacity-60 pointer-events-none"
          aria-hidden
        />

        {/* Inner icon container */}
        <span className="relative z-10 flex h-14 w-14 items-center justify-center">
          {isRecording ? (
            <Square className="h-8 w-8 text-white drop-shadow-lg" fill="currentColor" strokeWidth={0} />
          ) : (
            <Circle className="h-10 w-10 text-white drop-shadow-lg" fill="currentColor" strokeWidth={0} />
          )}
        </span>
      </motion.button>
    </div>
  )
}
