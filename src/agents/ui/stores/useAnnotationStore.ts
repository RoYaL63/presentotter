import { create } from 'zustand'
import type { AnnotationType } from '@interfaces'

export type AnnotationMode = AnnotationType | 'off'

export interface AnnotationState {
  mode: AnnotationMode
  color: string
  opacity: number
  setMode: (mode: AnnotationMode) => void
  setColor: (color: string) => void
  setOpacity: (opacity: number) => void
  reset: () => void
}

const initialState = {
  mode: 'off' as AnnotationMode,
  color: '#ef4444',
  opacity: 1
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  ...initialState,
  setMode: (mode) => set(() => ({ mode })),
  setColor: (color) => set(() => ({ color })),
  setOpacity: (opacity) =>
    set(() => ({ opacity: Math.min(1, Math.max(0, opacity)) })),
  reset: () => set(() => ({ ...initialState }))
}))
