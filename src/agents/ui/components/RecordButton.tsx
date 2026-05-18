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
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={isRecording ? 'Arrêter l\'enregistrement' : 'Démarrer l\'enregistrement'}
      className={`relative flex h-24 w-24 items-center justify-center rounded-full border-4 transition-colors ${
        disabled
          ? 'cursor-not-allowed border-slate-700 bg-slate-800 opacity-50'
          : isRecording
            ? 'border-red-400 bg-red-600 hover:bg-red-500'
            : 'border-red-500 bg-red-600 hover:bg-red-500'
      }`}
      animate={
        isRecording
          ? { scale: [1, 1.08, 1], boxShadow: ['0 0 0 0 rgba(239,68,68,0.6)', '0 0 0 16px rgba(239,68,68,0)', '0 0 0 0 rgba(239,68,68,0)'] }
          : { scale: 1 }
      }
      transition={isRecording ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      whileTap={{ scale: 0.95 }}
    >
      {isRecording ? (
        <Square className="h-10 w-10 text-white" fill="currentColor" />
      ) : (
        <Circle className="h-10 w-10 text-white" fill="currentColor" />
      )}
    </motion.button>
  )
}
