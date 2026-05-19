/**
 * Triple-tap Alt detector — global hotkey for cursor highlight.
 *
 * Electron's `globalShortcut.register` cannot bind a bare modifier (Alt
 * by itself is not a valid accelerator). We use uiohook-napi to listen
 * to raw OS keyboard events and count Alt keydowns inside a short
 * window. When three taps land within `WINDOW_MS`, we fire the callback.
 *
 * uiohook-napi reports both press AND release events; we count presses
 * only and rely on a small debounce (`MIN_GAP_MS`) so a *held* Alt key
 * — which the OS will repeat into many keydowns — does not look like a
 * triple tap.
 */

import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'

const WINDOW_MS = 600
const MIN_GAP_MS = 40
const COUNT_TO_FIRE = 3

let started = false
let lastDown = 0
let taps: number[] = []
let onTriple: (() => void) | null = null

function isAltKey(e: UiohookKeyboardEvent): boolean {
  return e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight
}

function handleKeyDown(e: UiohookKeyboardEvent): void {
  if (!isAltKey(e)) {
    // Any non-Alt keydown resets the streak so e.g. Alt+Tab does not
    // accidentally count toward the triple tap.
    taps = []
    return
  }
  const now = Date.now()
  if (now - lastDown < MIN_GAP_MS) {
    // Repeated keydown from the OS auto-repeat — ignore.
    return
  }
  lastDown = now
  taps = taps.filter((t) => now - t < WINDOW_MS)
  taps.push(now)
  if (taps.length >= COUNT_TO_FIRE) {
    taps = []
    onTriple?.()
  }
}

/**
 * Start listening. Safe to call multiple times — the underlying hook
 * is shared across consumers.
 */
export function startTripleAltDetector(cb: () => void): void {
  onTriple = cb
  if (started) return
  try {
    uIOhook.on('keydown', handleKeyDown)
    uIOhook.start()
    started = true
  } catch (err) {
    console.warn('[triple-alt] uiohook failed to start:', err)
  }
}

export function stopTripleAltDetector(): void {
  if (!started) return
  try {
    uIOhook.off('keydown', handleKeyDown)
    uIOhook.stop()
  } catch {
    // ignore
  }
  started = false
  onTriple = null
  taps = []
}
