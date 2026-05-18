import { create } from 'zustand'

interface ExportState {
  isExporting: boolean
  progress: number
  currentFrame: number
  eta: number
  outputPath: string | null
  error: string | null
  setStarted(): void
  setProgress(percent: number, currentFrame: number, eta: number): void
  setComplete(outputPath: string): void
  setError(message: string): void
  reset(): void
}

const initialState = {
  isExporting: false,
  progress: 0,
  currentFrame: 0,
  eta: 0,
  outputPath: null,
  error: null
} as const

export const useExportStore = create<ExportState>(set => ({
  ...initialState,
  setStarted: () =>
    set({
      isExporting: true,
      progress: 0,
      currentFrame: 0,
      eta: 0,
      outputPath: null,
      error: null
    }),
  setProgress: (percent, currentFrame, eta) =>
    set({ progress: percent, currentFrame, eta }),
  setComplete: outputPath =>
    set({ isExporting: false, progress: 100, outputPath, error: null }),
  setError: message => set({ isExporting: false, error: message }),
  reset: () => set({ ...initialState })
}))
