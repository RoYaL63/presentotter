import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eventBus } from '@event-bus'
import type { CaptureConfig, RawRecording } from '@interfaces'
import { registerUIEventListeners } from '../eventListeners'
import { useRecordingStore } from '../stores/useRecordingStore'
import { useLibraryStore } from '../stores/useLibraryStore'

const config: CaptureConfig = {
  source: 'screen',
  width: 1280,
  height: 720,
  fps: 30,
  audioInputs: { system: true, microphone: true }
}

function makeRawRecording(id: string): RawRecording {
  return {
    id,
    frames: [],
    audioData: Buffer.alloc(0),
    duration: 0,
    config,
    bookmarks: [],
    createdAt: new Date()
  }
}

describe('registerUIEventListeners', () => {
  let teardown: (() => void) | null = null

  beforeEach(() => {
    useRecordingStore.getState().reset()
    useLibraryStore.getState().reset()
    teardown = registerUIEventListeners()
  })

  afterEach(() => {
    teardown?.()
    teardown = null
  })

  it('capture:started flips the recording store to recording', () => {
    eventBus.emit('capture:started', {
      sessionId: 'evt-session-1',
      config,
      timestamp: Date.now()
    })
    const state = useRecordingStore.getState()
    expect(state.isRecording).toBe(true)
    expect(state.sessionId).toBe('evt-session-1')
    expect(state.config).toEqual(config)
  })

  it('capture:paused sets paused and updates elapsed', () => {
    eventBus.emit('capture:started', {
      sessionId: 'evt-session-2',
      config,
      timestamp: Date.now()
    })
    eventBus.emit('capture:paused', { sessionId: 'evt-session-2', elapsed: 4_000 })
    const state = useRecordingStore.getState()
    expect(state.isPaused).toBe(true)
    expect(state.elapsed).toBe(4_000)
  })

  it('capture:resumed clears the paused flag', () => {
    eventBus.emit('capture:started', {
      sessionId: 'evt-session-3',
      config,
      timestamp: Date.now()
    })
    eventBus.emit('capture:paused', { sessionId: 'evt-session-3', elapsed: 1_000 })
    eventBus.emit('capture:resumed', { sessionId: 'evt-session-3' })
    expect(useRecordingStore.getState().isPaused).toBe(false)
  })

  it('capture:stopped resets the recording store', () => {
    eventBus.emit('capture:started', {
      sessionId: 'evt-session-4',
      config,
      timestamp: Date.now()
    })
    eventBus.emit('capture:stopped', {
      sessionId: 'evt-session-4',
      rawRecording: makeRawRecording('evt-session-4')
    })
    const state = useRecordingStore.getState()
    expect(state.isRecording).toBe(false)
    expect(state.sessionId).toBeNull()
  })

  it('library:recording-deleted removes the entry from the library store', () => {
    useLibraryStore.getState().addRecording({
      id: 'lib-1',
      name: 'Demo',
      duration: 1_000,
      createdAt: new Date(),
      updatedAt: new Date(),
      sanitized: false,
      tags: []
    })
    eventBus.emit('library:recording-deleted', { id: 'lib-1' })
    expect(useLibraryStore.getState().recordings).toHaveLength(0)
  })

  it('library:recording-renamed updates the entry name', () => {
    useLibraryStore.getState().addRecording({
      id: 'lib-2',
      name: 'Old',
      duration: 1_000,
      createdAt: new Date(),
      updatedAt: new Date(),
      sanitized: false,
      tags: []
    })
    eventBus.emit('library:recording-renamed', { id: 'lib-2', newName: 'New' })
    expect(useLibraryStore.getState().recordings[0]?.name).toBe('New')
  })

  it('teardown unsubscribes listeners', () => {
    teardown?.()
    teardown = null
    eventBus.emit('capture:started', {
      sessionId: 'evt-session-5',
      config,
      timestamp: Date.now()
    })
    expect(useRecordingStore.getState().isRecording).toBe(false)
  })
})
