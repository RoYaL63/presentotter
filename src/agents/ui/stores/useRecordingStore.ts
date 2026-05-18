import { create } from 'zustand'
import type { CaptureConfig } from '@interfaces'

export interface RecordingState {
  isRecording: boolean
  isPaused: boolean
  elapsed: number
  sessionId: string | null
  config: CaptureConfig | null
  startRecording: (config: CaptureConfig, sessionId?: string) => void
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: () => void
  tick: (elapsed: number) => void
  reset: () => void
}

const initialState = {
  isRecording: false,
  isPaused: false,
  elapsed: 0,
  sessionId: null,
  config: null
} as const

export const useRecordingStore = create<RecordingState>((set) => ({
  ...initialState,
  startRecording: (config, sessionId) =>
    set(() => ({
      isRecording: true,
      isPaused: false,
      elapsed: 0,
      sessionId: sessionId ?? `session-${Date.now()}`,
      config
    })),
  pauseRecording: () =>
    set((state) => (state.isRecording ? { isPaused: true } : {})),
  resumeRecording: () =>
    set((state) => (state.isRecording ? { isPaused: false } : {})),
  stopRecording: () =>
    set(() => ({
      isRecording: false,
      isPaused: false,
      sessionId: null
    })),
  tick: (elapsed) => set(() => ({ elapsed })),
  reset: () => set(() => ({ ...initialState }))
}))
