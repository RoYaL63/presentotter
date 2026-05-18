import { create } from 'zustand'
import type { RecordingLibraryEntry } from '@interfaces'

export interface LibraryState {
  recordings: RecordingLibraryEntry[]
  addRecording: (recording: RecordingLibraryEntry) => void
  removeRecording: (id: string) => void
  renameRecording: (id: string, newName: string) => void
  setTags: (id: string, tags: string[]) => void
  reset: () => void
}

export const useLibraryStore = create<LibraryState>((set) => ({
  recordings: [],
  addRecording: (recording) =>
    set((state) => ({
      recordings: [...state.recordings.filter((r) => r.id !== recording.id), recording]
    })),
  removeRecording: (id) =>
    set((state) => ({
      recordings: state.recordings.filter((r) => r.id !== id)
    })),
  renameRecording: (id, newName) =>
    set((state) => ({
      recordings: state.recordings.map((r) =>
        r.id === id ? { ...r, name: newName, updatedAt: new Date() } : r
      )
    })),
  setTags: (id, tags) =>
    set((state) => ({
      recordings: state.recordings.map((r) =>
        r.id === id ? { ...r, tags, updatedAt: new Date() } : r
      )
    })),
  reset: () => set(() => ({ recordings: [] }))
}))
