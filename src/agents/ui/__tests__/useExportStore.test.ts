import { describe, it, expect, beforeEach } from 'vitest'
import { useExportStore } from '../stores/useExportStore'

describe('useExportStore', () => {
  beforeEach(() => {
    useExportStore.getState().reset()
  })

  it('starts in a clean idle state', () => {
    const state = useExportStore.getState()
    expect(state.isExporting).toBe(false)
    expect(state.progress).toBe(0)
    expect(state.outputPath).toBeNull()
    expect(state.error).toBeNull()
  })

  it('setStarted flips isExporting to true and resets progress', () => {
    useExportStore.setState({ progress: 50 })
    useExportStore.getState().setStarted()
    const state = useExportStore.getState()
    expect(state.isExporting).toBe(true)
    expect(state.progress).toBe(0)
  })

  it('setProgress updates percent, currentFrame and eta', () => {
    useExportStore.getState().setProgress(42, 120, 3)
    const state = useExportStore.getState()
    expect(state.progress).toBe(42)
    expect(state.currentFrame).toBe(120)
    expect(state.eta).toBe(3)
  })

  it('setComplete clears isExporting and stores outputPath', () => {
    useExportStore.getState().setStarted()
    useExportStore.getState().setComplete('/tmp/out.mp4')
    const state = useExportStore.getState()
    expect(state.isExporting).toBe(false)
    expect(state.progress).toBe(100)
    expect(state.outputPath).toBe('/tmp/out.mp4')
  })

  it('setError stores the error message and clears isExporting', () => {
    useExportStore.getState().setStarted()
    useExportStore.getState().setError('FFmpeg crashed')
    const state = useExportStore.getState()
    expect(state.isExporting).toBe(false)
    expect(state.error).toBe('FFmpeg crashed')
  })

  it('reset returns to the initial state', () => {
    useExportStore.getState().setStarted()
    useExportStore.getState().setProgress(50, 100, 2)
    useExportStore.getState().reset()
    const state = useExportStore.getState()
    expect(state.isExporting).toBe(false)
    expect(state.progress).toBe(0)
    expect(state.outputPath).toBeNull()
  })
})
