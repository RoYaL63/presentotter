import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { CaptureConfig } from '@interfaces'
import { CaptureSessionManager } from '../session-manager'

const config: CaptureConfig = {
  source: 'screen',
  width: 8,
  height: 8,
  fps: 30,
  audioInputs: { system: true, microphone: false }
}

describe('CaptureSessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs a full start → bookmark → pause → resume → stop cycle', async () => {
    const manager = new CaptureSessionManager(config)
    const session = await manager.start()
    expect(session.status).toBe('active')
    expect(session.id).toBeTruthy()

    await vi.advanceTimersByTimeAsync(60)
    manager.addBookmark('step-1')

    manager.pause()
    expect(manager.getSession()?.status).toBe('paused')

    await vi.advanceTimersByTimeAsync(100)
    manager.resume()
    expect(manager.getSession()?.status).toBe('active')

    await vi.advanceTimersByTimeAsync(60)
    manager.addBookmark('step-2')

    const finalSession = await manager.stop()

    expect(finalSession.status).toBe('stopped')
    expect(finalSession.endedAt).toBeInstanceOf(Date)
    expect(finalSession.rawRecording).toBeDefined()
    expect(finalSession.rawRecording!.frames.length).toBeGreaterThan(0)
    expect(finalSession.rawRecording!.duration).toBeGreaterThan(0)
    expect(finalSession.rawRecording!.bookmarks.length).toBe(2)
    expect(finalSession.rawRecording!.bookmarks[0].label).toBe('step-1')
    expect(finalSession.rawRecording!.bookmarks[1].label).toBe('step-2')
    expect(manager.getSession()).toBeNull()
  })

  it('throws when starting twice in a row', async () => {
    const manager = new CaptureSessionManager(config)
    await manager.start()
    await expect(manager.start()).rejects.toThrow(/already in progress/i)
    await manager.stop()
  })

  it('throws when stopping without an active session', async () => {
    const manager = new CaptureSessionManager(config)
    await expect(manager.stop()).rejects.toThrow(/no active session/i)
  })
})
