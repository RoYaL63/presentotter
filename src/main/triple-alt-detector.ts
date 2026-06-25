/**
 * Global keyboard hooks via uiohook-napi.
 *
 * Two callbacks bound on the same low-level hook:
 *   - triple-tap Alt → toggle cursor highlight
 *   - Escape press → reset the active annotation tool to 'select'
 *
 * Why uiohook instead of Electron's globalShortcut for Escape:
 *   globalShortcut.register('Escape') can silently fail when another
 *   running app already owns that accelerator (very common — Escape is
 *   used by every modal, file picker, etc.). uiohook taps the raw OS
 *   stream so we always see the press, and crucially does NOT consume
 *   the event — Chrome / Word / whoever else needs Escape still gets
 *   it normally.
 *
 * Why we count Alt taps rather than bind a "triple Alt" accelerator:
 *   Electron's accelerator grammar has no notion of "this key tapped N
 *   times". Manual counting via raw events is the supported path.
 */

import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'

const WINDOW_MS = 600
const MIN_GAP_MS = 40
const COUNT_TO_FIRE = 3

let started = false
let lastDown = 0
let taps: number[] = []
let onTriple: (() => void) | null = null
let onEscape: (() => void) | null = null

function isAltKey(e: UiohookKeyboardEvent): boolean {
  return e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight
}

function isEscapeKey(e: UiohookKeyboardEvent): boolean {
  return e.keycode === UiohookKey.Escape
}

function handleKeyDown(e: UiohookKeyboardEvent): void {
  if (isEscapeKey(e)) {
    // Reset the active tool, but do not block Escape from reaching the
    // focused app — uiohook is observation-only by default.
    onEscape?.()
    // Escape also breaks any in-progress triple-Alt streak.
    taps = []
    return
  }
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

/** Register the Escape callback. Independent of triple-alt — both fire
 *  off the same single key hook so we don't pay for two listeners. */
export function setEscapeHandler(cb: (() => void) | null): void {
  onEscape = cb
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
  onEscape = null
  taps = []
}
