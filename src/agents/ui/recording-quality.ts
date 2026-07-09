/**
 * Shared recording-quality helpers used by both recorders (RegionRecorder
 * for a screen region, RecordingPanel for a full screen / window).
 *
 * The whole point of this module is fluidity. The old code hard-coded
 * `video/webm;codecs=vp9` first — VP9 has the heaviest software encoder of
 * the lot, so on anything past 1080p the CPU can't keep up in real time and
 * MediaRecorder silently drops frames. That is exactly the "saccadé / laggy"
 * capture the user sees, while a browser screen-share feels smooth because it
 * uses the platform's HARDWARE H.264 encoder (near-zero CPU).
 *
 * So we:
 *   1. Prefer H.264 in an MP4 container (hardware-accelerated on Windows via
 *      Media Foundation) → smoothest, and already the format most editors and
 *      players want.
 *   2. Fall back to VP8 (much lighter software encoder than VP9).
 *   3. Only use VP9 as a last resort.
 *   4. Scale the bitrate with the resolution so a 1440p/4K capture isn't
 *      starved at 6 Mbit/s (which looked mushy) — while staying bounded so a
 *      software encoder isn't buried.
 */

export interface RecorderMime {
  /** MIME string to hand MediaRecorder. Empty = let the UA pick a default. */
  mimeType: string
  /** File extension matching the container. */
  ext: 'mp4' | 'webm'
}

/** Target capture frame rate. 60 fps is what makes screen motion read as
 *  "smooth like Google" instead of the choppy 30-ish we ended up at when the
 *  encoder fell behind. */
export const TARGET_FPS = 60

/**
 * Pick the best-supported recorder container/codec, most-fluid first.
 * `MediaRecorder.isTypeSupported` is evaluated at runtime, so if the platform
 * can't hardware-encode H.264 we transparently drop to VP8.
 */
export function pickRecorderMime(): RecorderMime {
  const candidates: RecorderMime[] = [
    // Hardware H.264 in MP4 — the fluid path on Windows.
    { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264,aac', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    // VP8 — light software encoder, smooth fallback in a WebM container.
    { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    // VP9 — heaviest encoder, last resort.
    { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' }
  ]
  const supported =
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function'
  for (const c of candidates) {
    if (!supported) break
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c
  }
  // Nothing matched (or no MediaRecorder in this context): empty MIME lets the
  // UA choose, and we assume WebM for the extension.
  return { mimeType: '', ext: 'webm' }
}

/**
 * Bitrate (bits/second) sized to the capture resolution + frame rate, so the
 * picture stays crisp at 1440p/4K without over-driving a software encoder.
 * ~0.11 bits/pixel is a good middle ground for screen content; clamped to a
 * sane [8, 40] Mbit/s window.
 */
export function computeVideoBitrate(
  width: number,
  height: number,
  fps: number
): number {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const f = Math.max(1, Math.round(fps))
  const BITS_PER_PIXEL = 0.11
  const MIN = 8_000_000
  const MAX = 40_000_000
  const raw = w * h * f * BITS_PER_PIXEL
  return Math.round(Math.min(MAX, Math.max(MIN, raw)))
}
