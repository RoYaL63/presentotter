import { describe, it, expect } from 'vitest'
import { PRESETS, getPresetForFormat } from '../presets'

describe('PRESETS catalog', () => {
  it('contains all P0 presets', () => {
    expect(PRESETS.MP4_TUTORIAL_HD).toBeDefined()
    expect(PRESETS.MP4_DEMO_LIGHT).toBeDefined()
    expect(PRESETS.MP4_LOSSLESS).toBeDefined()
    expect(PRESETS.WEBM_WEB).toBeDefined()
    expect(PRESETS.GIF_SOCIAL).toBeDefined()
    expect(PRESETS.GIF_HD).toBeDefined()
  })

  it('MP4_LOSSLESS uses crf=0', () => {
    expect(PRESETS.MP4_LOSSLESS?.bitrate).toBe('crf=0')
  })
})

describe('getPresetForFormat', () => {
  it('mp4 + high returns MP4_TUTORIAL_HD', () => {
    expect(getPresetForFormat('mp4', 'high')).toBe(PRESETS.MP4_TUTORIAL_HD)
  })

  it('mp4 + lossless returns MP4_LOSSLESS', () => {
    expect(getPresetForFormat('mp4', 'lossless')).toBe(PRESETS.MP4_LOSSLESS)
  })

  it('mp4 + medium returns MP4_DEMO_LIGHT', () => {
    expect(getPresetForFormat('mp4', 'medium')).toBe(PRESETS.MP4_DEMO_LIGHT)
  })

  it('webm always returns WEBM_WEB', () => {
    expect(getPresetForFormat('webm', 'low')).toBe(PRESETS.WEBM_WEB)
    expect(getPresetForFormat('webm', 'high')).toBe(PRESETS.WEBM_WEB)
  })

  it('gif + high returns GIF_HD', () => {
    expect(getPresetForFormat('gif', 'high')).toBe(PRESETS.GIF_HD)
  })

  it('gif + low returns GIF_SOCIAL', () => {
    expect(getPresetForFormat('gif', 'low')).toBe(PRESETS.GIF_SOCIAL)
  })
})
