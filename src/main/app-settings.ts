import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Tiny persisted-settings store for things the MAIN process needs at
 * startup, before any renderer is alive — currently just the capture
 * hotkeys. Backed by a plain JSON file in userData (no extra dependency,
 * no ESM/CJS interop surprises). Renderer-only prefs keep living in their
 * zustand+localStorage stores; this is only for main-side config.
 */

export interface CaptureHotkeys {
  /** Accelerator for the photo capture (region screenshot). */
  capturePhoto: string
  /** Accelerator that toggles region video recording. */
  captureVideo: string
}

/** Recording frame rate. 60 by default so motion is smooth out of the box. */
export type CaptureFps = 30 | 60

interface SettingsShape {
  captureHotkeys: CaptureHotkeys
  captureFps: CaptureFps
}

const DEFAULTS: CaptureHotkeys = {
  capturePhoto: 'Alt+Shift+S',
  captureVideo: 'Alt+Shift+R'
}

const DEFAULT_FPS: CaptureFps = 60

let cache: SettingsShape | null = null

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'po-settings.json')
}

function load(): SettingsShape {
  if (cache !== null) return cache
  try {
    const raw = readFileSync(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<SettingsShape>
    cache = {
      captureHotkeys: { ...DEFAULTS, ...(parsed.captureHotkeys ?? {}) },
      captureFps: parsed.captureFps === 30 || parsed.captureFps === 60
        ? parsed.captureFps
        : DEFAULT_FPS
    }
  } catch {
    cache = { captureHotkeys: { ...DEFAULTS }, captureFps: DEFAULT_FPS }
  }
  return cache
}

function persist(): void {
  if (cache === null) return
  try {
    writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    console.error('[settings] persist failed:', err)
  }
}

export function getCaptureHotkeys(): CaptureHotkeys {
  return { ...DEFAULTS, ...load().captureHotkeys }
}

export function setCaptureHotkeys(next: Partial<CaptureHotkeys>): CaptureHotkeys {
  const c = load()
  c.captureHotkeys = { ...DEFAULTS, ...c.captureHotkeys, ...next }
  persist()
  return { ...c.captureHotkeys }
}

export function getDefaultCaptureHotkeys(): CaptureHotkeys {
  return { ...DEFAULTS }
}

export function getCaptureFps(): CaptureFps {
  return load().captureFps
}

export function setCaptureFps(fps: CaptureFps): CaptureFps {
  const c = load()
  c.captureFps = fps === 30 ? 30 : 60
  persist()
  return c.captureFps
}
