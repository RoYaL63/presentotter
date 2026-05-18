import { createWorker, type Worker as TesseractWorker } from 'tesseract.js'
import { PATTERNS } from '../sanitizer'

/**
 * Live sanitizer scan engine.
 *
 * One scan cycle =
 *   1. Capture a frame from the user's screen (getDisplayMedia, no prompt
 *      thanks to setDisplayMediaRequestHandler in main).
 *   2. OCR with Tesseract.js — returns words + their pixel bounding boxes.
 *   3. Concatenate the OCR words back into a flat string and run the
 *      Gardien analyzer regexes. For every regex match, find which OCR
 *      words contributed to that match and union their bboxes.
 *   4. Send the resulting list of bboxes to the overlay window so it can
 *      draw opaque masks on top — the masks are visible in any concurrent
 *      screen-share (Meet, Zoom, Teams, OBS), shielding the real pixels.
 *
 * Performance notes:
 *   - Tesseract.js is heavy (~10 MB WASM + traineddata). The worker is
 *     created lazily on the first scan and reused across cycles.
 *   - Full-resolution OCR on 1080p takes 1-3 s on a recent laptop. We
 *     downscale the capture to 1280 px wide before OCR which keeps each
 *     scan under ~1 s in the common case.
 *   - Scans run on an interval (default 2 s). When the user toggles off,
 *     the stream is stopped and the worker terminated.
 */

export interface LiveMask {
  x: number
  y: number
  width: number
  height: number
  label: string
}

export interface ScanResult {
  masks: LiveMask[]
  scanDurationMs: number
}

interface TesseractWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

const MAX_SCAN_WIDTH = 1280
const DEFAULT_INTERVAL_MS = 2000

export class SanitizerLiveEngine {
  private worker: TesseractWorker | null = null
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement
  private interval: number | null = null
  private running = false
  private scanInFlight = false

  constructor() {
    this.canvas = document.createElement('canvas')
  }

  /** Start the periodic scan loop. Idempotent. */
  async start(intervalMs: number = DEFAULT_INTERVAL_MS, onScan?: (r: ScanResult) => void): Promise<void> {
    if (this.running) return
    this.running = true
    await this.acquireStream()
    await this.ensureWorker()
    // Kick a first scan immediately so the user gets feedback fast
    void this.scanOnce(onScan)
    this.interval = window.setInterval(() => {
      void this.scanOnce(onScan)
    }, intervalMs)
  }

  /** Run a single scan on demand (independent of the periodic loop). */
  async scanNow(onScan?: (r: ScanResult) => void): Promise<ScanResult | null> {
    if (this.scanInFlight) return null
    await this.acquireStream()
    await this.ensureWorker()
    return await this.scanOnce(onScan)
  }

  /** Stop the loop, release the screen capture stream and terminate Tesseract. */
  async stop(): Promise<void> {
    this.running = false
    if (this.interval !== null) {
      window.clearInterval(this.interval)
      this.interval = null
    }
    if (this.stream !== null) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    if (this.video !== null) {
      this.video.srcObject = null
      this.video = null
    }
    if (this.worker !== null) {
      try {
        await this.worker.terminate()
      } catch {
        // ignore termination errors — worker may already be down
      }
      this.worker = null
    }
  }

  // ---------- internals ----------

  private async acquireStream(): Promise<void> {
    if (this.stream !== null) return
    // Electron's setDisplayMediaRequestHandler returns the primary screen
    // without a system picker prompt.
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    })
    const video = document.createElement('video')
    video.srcObject = this.stream
    video.muted = true
    video.playsInline = true
    await video.play()
    // Wait until the video knows its dimensions
    if (video.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        const handler = () => {
          video.removeEventListener('loadedmetadata', handler)
          resolve()
        }
        video.addEventListener('loadedmetadata', handler)
      })
    }
    this.video = video
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker !== null) return
    // Default to English; users can add 'fra' later via settings. Tesseract
    // downloads traineddata on first init (~3-5 MB cached after that).
    this.worker = await createWorker('eng')
  }

  private async scanOnce(onScan?: (r: ScanResult) => void): Promise<ScanResult | null> {
    if (this.video === null || this.worker === null) return null
    if (this.scanInFlight) return null
    this.scanInFlight = true
    const startedAt = performance.now()
    try {
      const { dataUrl, scaleX, scaleY } = this.captureFrameToDataUrl(this.video)
      const result = await this.worker.recognize(dataUrl)
      // tesseract.js v5 exposes detailed words via `result.data.words` when
      // requested. We narrow via an unknown cast — the public types are loose.
      const data = result.data as unknown as { text?: string; words?: TesseractWord[] }
      const words = Array.isArray(data.words) ? data.words : []
      const masks = this.detectMasks(words, scaleX, scaleY)
      const out: ScanResult = {
        masks,
        scanDurationMs: Math.round(performance.now() - startedAt)
      }
      onScan?.(out)
      return out
    } finally {
      this.scanInFlight = false
    }
  }

  private captureFrameToDataUrl(video: HTMLVideoElement): {
    dataUrl: string
    scaleX: number
    scaleY: number
  } {
    const srcW = video.videoWidth
    const srcH = video.videoHeight
    const scale = srcW > MAX_SCAN_WIDTH ? MAX_SCAN_WIDTH / srcW : 1
    const dstW = Math.floor(srcW * scale)
    const dstH = Math.floor(srcH * scale)
    this.canvas.width = dstW
    this.canvas.height = dstH
    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      return { dataUrl: '', scaleX: 1, scaleY: 1 }
    }
    ctx.drawImage(video, 0, 0, dstW, dstH)
    // The scale factor from the (downscaled) OCR coordinates back to
    // (full-screen) overlay coordinates is the inverse of the downscale.
    return {
      dataUrl: this.canvas.toDataURL('image/png'),
      scaleX: 1 / scale,
      scaleY: 1 / scale
    }
  }

  private detectMasks(words: TesseractWord[], scaleX: number, scaleY: number): LiveMask[] {
    if (words.length === 0) return []
    // Build the flat OCR text + a char-range → word index lookup so we can
    // map each regex hit back to the words that produced it.
    let text = ''
    const wordRanges: Array<{ start: number; end: number; idx: number }> = []
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (!w) continue
      const start = text.length
      text += w.text
      const end = text.length
      wordRanges.push({ start, end, idx: i })
      text += ' '
    }

    const masks: LiveMask[] = []
    for (const pattern of PATTERNS) {
      // Reset global regex state
      pattern.regex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.regex.exec(text)) !== null) {
        const start = match.index
        const end = start + match[0].length
        // Find every word range that intersects the match
        const touched = wordRanges.filter((r) => r.start < end && r.end > start)
        if (touched.length === 0) {
          // Avoid infinite loops on zero-width matches
          if (match[0].length === 0) pattern.regex.lastIndex += 1
          continue
        }
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const r of touched) {
          const w = words[r.idx]
          if (!w) continue
          const b = w.bbox
          if (b.x0 < x0) x0 = b.x0
          if (b.y0 < y0) y0 = b.y0
          if (b.x1 > x1) x1 = b.x1
          if (b.y1 > y1) y1 = b.y1
        }
        if (x0 === Infinity) {
          if (match[0].length === 0) pattern.regex.lastIndex += 1
          continue
        }
        // Add a small padding so the mask covers the letters fully
        const PAD = 4
        masks.push({
          x: Math.max(0, Math.floor(x0 * scaleX) - PAD),
          y: Math.max(0, Math.floor(y0 * scaleY) - PAD),
          width: Math.ceil((x1 - x0) * scaleX) + PAD * 2,
          height: Math.ceil((y1 - y0) * scaleY) + PAD * 2,
          label: pattern.name
        })
        // Defend against pathological zero-width matches
        if (match[0].length === 0) pattern.regex.lastIndex += 1
      }
    }

    return mergeOverlappingMasks(masks)
  }
}

/**
 * Two patterns can match the same region (e.g. a JWT also matches the
 * generic api-key regex). Union overlapping rectangles to keep the overlay
 * clean and predictable.
 */
function mergeOverlappingMasks(input: LiveMask[]): LiveMask[] {
  const out: LiveMask[] = []
  for (const m of input) {
    const hit = out.find((o) => rectsOverlap(o, m))
    if (hit) {
      const x0 = Math.min(hit.x, m.x)
      const y0 = Math.min(hit.y, m.y)
      const x1 = Math.max(hit.x + hit.width, m.x + m.width)
      const y1 = Math.max(hit.y + hit.height, m.y + m.height)
      hit.x = x0
      hit.y = y0
      hit.width = x1 - x0
      hit.height = y1 - y0
      if (!hit.label.includes(m.label)) hit.label = `${hit.label}, ${m.label}`
    } else {
      out.push({ ...m })
    }
  }
  return out
}

function rectsOverlap(a: LiveMask, b: LiveMask): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}
