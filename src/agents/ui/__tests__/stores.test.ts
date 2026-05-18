import { beforeEach, describe, expect, it } from 'vitest'
import type { CaptureConfig, RecordingLibraryEntry } from '@interfaces'
import { useRecordingStore } from '../stores/useRecordingStore'
import { useAnnotationStore } from '../stores/useAnnotationStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useNavStore } from '../stores/useNavStore'

const config: CaptureConfig = {
  source: 'screen',
  width: 1920,
  height: 1080,
  fps: 30,
  audioInputs: { system: true, microphone: false }
}

function makeEntry(id: string, overrides: Partial<RecordingLibraryEntry> = {}): RecordingLibraryEntry {
  return {
    id,
    name: `Recording ${id}`,
    duration: 12_000,
    createdAt: new Date('2026-05-18T10:00:00Z'),
    updatedAt: new Date('2026-05-18T10:00:00Z'),
    sanitized: false,
    tags: [],
    ...overrides
  }
}

describe('useRecordingStore', () => {
  beforeEach(() => {
    useRecordingStore.getState().reset()
  })

  it('starts with a clean initial state', () => {
    const state = useRecordingStore.getState()
    expect(state.isRecording).toBe(false)
    expect(state.isPaused).toBe(false)
    expect(state.elapsed).toBe(0)
    expect(state.sessionId).toBeNull()
    expect(state.config).toBeNull()
  })

  it('startRecording sets the session and config', () => {
    useRecordingStore.getState().startRecording(config, 'session-1')
    const state = useRecordingStore.getState()
    expect(state.isRecording).toBe(true)
    expect(state.isPaused).toBe(false)
    expect(state.sessionId).toBe('session-1')
    expect(state.config).toEqual(config)
  })

  it('pause/resume only flip the paused flag', () => {
    useRecordingStore.getState().startRecording(config, 'session-2')
    useRecordingStore.getState().pauseRecording()
    expect(useRecordingStore.getState().isPaused).toBe(true)
    expect(useRecordingStore.getState().isRecording).toBe(true)
    useRecordingStore.getState().resumeRecording()
    expect(useRecordingStore.getState().isPaused).toBe(false)
  })

  it('pause is a no-op when not recording', () => {
    useRecordingStore.getState().pauseRecording()
    expect(useRecordingStore.getState().isPaused).toBe(false)
  })

  it('stopRecording clears the session', () => {
    useRecordingStore.getState().startRecording(config, 'session-3')
    useRecordingStore.getState().stopRecording()
    const state = useRecordingStore.getState()
    expect(state.isRecording).toBe(false)
    expect(state.isPaused).toBe(false)
    expect(state.sessionId).toBeNull()
  })

  it('tick updates elapsed without mutating other fields', () => {
    useRecordingStore.getState().startRecording(config, 'session-4')
    const before = useRecordingStore.getState()
    useRecordingStore.getState().tick(5_000)
    const after = useRecordingStore.getState()
    expect(after.elapsed).toBe(5_000)
    expect(after.sessionId).toBe(before.sessionId)
    expect(after.config).toBe(before.config)
  })
})

describe('useAnnotationStore', () => {
  beforeEach(() => {
    useAnnotationStore.getState().reset()
  })

  it('starts in off mode with sensible defaults', () => {
    const state = useAnnotationStore.getState()
    expect(state.mode).toBe('off')
    expect(state.color).toBe('#ef4444')
    expect(state.opacity).toBe(1)
  })

  it('setMode/setColor/setOpacity update the store', () => {
    useAnnotationStore.getState().setMode('arrow')
    useAnnotationStore.getState().setColor('#00ff00')
    useAnnotationStore.getState().setOpacity(0.5)
    const state = useAnnotationStore.getState()
    expect(state.mode).toBe('arrow')
    expect(state.color).toBe('#00ff00')
    expect(state.opacity).toBe(0.5)
  })

  it('clamps opacity into [0, 1]', () => {
    useAnnotationStore.getState().setOpacity(2)
    expect(useAnnotationStore.getState().opacity).toBe(1)
    useAnnotationStore.getState().setOpacity(-1)
    expect(useAnnotationStore.getState().opacity).toBe(0)
  })
})

describe('useLibraryStore', () => {
  beforeEach(() => {
    useLibraryStore.getState().reset()
  })

  it('starts with an empty list', () => {
    expect(useLibraryStore.getState().recordings).toEqual([])
  })

  it('addRecording is immutable and dedupes by id', () => {
    const { addRecording } = useLibraryStore.getState()
    const first = makeEntry('a')
    addRecording(first)
    const before = useLibraryStore.getState().recordings
    addRecording(makeEntry('a', { name: 'Updated' }))
    const after = useLibraryStore.getState().recordings
    expect(after).toHaveLength(1)
    expect(after[0]?.name).toBe('Updated')
    expect(after).not.toBe(before)
  })

  it('removeRecording filters by id', () => {
    const { addRecording, removeRecording } = useLibraryStore.getState()
    addRecording(makeEntry('a'))
    addRecording(makeEntry('b'))
    removeRecording('a')
    const ids = useLibraryStore.getState().recordings.map((r) => r.id)
    expect(ids).toEqual(['b'])
  })

  it('renameRecording updates name and updatedAt', () => {
    const { addRecording, renameRecording } = useLibraryStore.getState()
    addRecording(makeEntry('a'))
    const originalUpdatedAt = useLibraryStore.getState().recordings[0]?.updatedAt
    renameRecording('a', 'Renamed')
    const entry = useLibraryStore.getState().recordings[0]
    expect(entry?.name).toBe('Renamed')
    expect(entry?.updatedAt).not.toBe(originalUpdatedAt)
  })

  it('setTags replaces the tags array', () => {
    const { addRecording, setTags } = useLibraryStore.getState()
    addRecording(makeEntry('a'))
    setTags('a', ['demo', 'fr'])
    expect(useLibraryStore.getState().recordings[0]?.tags).toEqual(['demo', 'fr'])
  })
})

describe('useNavStore', () => {
  it('navigates between pages', () => {
    expect(useNavStore.getState().currentPage).toBe('home')
    useNavStore.getState().navigate('library')
    expect(useNavStore.getState().currentPage).toBe('library')
    useNavStore.getState().navigate('home')
  })
})
