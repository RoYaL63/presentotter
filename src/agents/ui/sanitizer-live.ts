import { createWorker, type Worker as TesseractWorker } from 'tesseract.js'
import { PATTERNS } from '../sanitizer'

/**
 * Gate verbose tracing behind a global flag so production users don't see
 * scan logs in their DevTools console.
 *
 * Enable from the DevTools console with:
 *     window.__PRESENTOTTER_DEBUG = true
 */
function debug(...args: unknown[]): void {
  const flag = (globalThis as { __PRESENTOTTER_DEBUG?: boolean }).__PRESENTOTTER_DEBUG
  if (flag === true) {
    console.warn('[sanitizer-live]', ...args)
  }
}

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
  /** Virtual-screen CSS X — same coordinate space as `window.screenX`. */
  x: number
  /** Virtual-screen CSS Y — same coordinate space as `window.screenY`. */
  y: number
  width: number
  height: number
  label: string
}

export interface ScanResult {
  masks: LiveMask[]
  /** Bounding boxes of every word OCR'd this cycle (virtual-screen CSS).
   *  Used by the debug overlay so the user can see WHAT Tesseract is
   *  seeing — separates "OCR missed the word" from "word seen but no
   *  pattern matched". */
  ocrWords: OcrWordBox[]
  /** Concatenated OCR text trimmed to the first ~120 chars — surfaces
   *  in the toolbar status so the user knows scans are happening. */
  preview: string
  /** Total words Tesseract returned (regardless of how many we masked). */
  wordCount: number
  scanDurationMs: number
}

export interface OcrWordBox {
  x: number
  y: number
  width: number
  height: number
  text: string
}

interface TesseractWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface CaptureTarget {
  sourceId: string
  displayId: number
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

const MAX_SCAN_WIDTH = 1280
// 1 s cadence (was 2 s) shrinks the worst-case "secret visible" window.
// Combined with the sticky pool (15 s TTL + overlap matching) on the
// Toolbar side, a single missed scan no longer causes a flicker.
const DEFAULT_INTERVAL_MS = 1000
// Tiny thumbnail used to fingerprint each frame. 16×9 = 144 cells is
// enough to detect "the user moved their mouse / scrolled" vs "the
// screen is the same as 1 s ago" without burning real CPU.
const SIGNATURE_W = 16
const SIGNATURE_H = 9
// Per-cell luminance delta tolerated as "no visible change". 10 means
// roughly 4% of the 0-255 range — small mouse moves and AA jitter
// pass, real content changes (text scrolling, new app) get caught.
const SIGNATURE_TOLERANCE = 10
// Even if the signature says "nothing changed", we force a real OCR
// every N skips so any drift the 16x9 thumbnail averaged out (a tiny
// secret typed in one cell, low-contrast text) can't hide forever.
// At 1 s cadence this means a worst-case 5 s delay for a missed
// change — still way under the sticky pool's 15 s TTL.
const FORCE_OCR_EVERY_N_SKIPS = 5
// JPEG quality used for the OCR input. PNG was paying ~50 ms per
// frame for lossless encoding we don't need; JPEG at 0.6 is plenty
// for Tesseract and shaves 30-50 ms per scan.
const OCR_JPEG_QUALITY = 0.6

/**
 * getUserMedia constraints for Electron's desktop-capture pipeline.
 *
 * Electron specifically supports the legacy "mandatory" form of the
 * MediaTrackConstraints object for capturing a chosen desktop source by
 * its `chromeMediaSourceId`. Browsers shipped a different syntax; we
 * type the shape locally so TypeScript does not reject the Electron
 * extension.
 */
interface ElectronDesktopConstraints {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
    maxWidth?: number
    maxHeight?: number
    minFrameRate?: number
  }
}

export class SanitizerLiveEngine {
  private worker: TesseractWorker | null = null
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement
  /** Tiny 16×9 thumbnail used to fingerprint each frame so we can
   *  skip the expensive OCR step when the screen hasn't changed. */
  private sigCanvas: HTMLCanvasElement
  private lastSignature: Uint8Array | null = null
  private skipCount = 0
  private interval: number | null = null
  private running = false
  private scanInFlight = false
  private target: CaptureTarget | null = null
  /** Whether to run the label-based contextual detection pass on top
   *  of the regex pass. Toggleable live via setContextual(). */
  private contextual = true

  constructor() {
    this.canvas = document.createElement('canvas')
    this.sigCanvas = document.createElement('canvas')
    this.sigCanvas.width = SIGNATURE_W
    this.sigCanvas.height = SIGNATURE_H
  }

  setContextual(enabled: boolean): void {
    this.contextual = enabled
  }

  /** Start the periodic scan loop. Idempotent. */
  async start(
    intervalMs: number = DEFAULT_INTERVAL_MS,
    onScan?: (r: ScanResult) => void,
    onStatus?: (s: 'acquiring' | 'loading-ocr' | 'scanning' | 'idle') => void
  ): Promise<void> {
    if (this.running) return
    this.running = true
    onStatus?.('acquiring')
    debug('acquireStream...')
    await this.acquireStream()
    debug('stream OK, video size:', this.video?.videoWidth, 'x', this.video?.videoHeight)
    onStatus?.('loading-ocr')
    debug('ensureWorker (Tesseract)...')
    await this.ensureWorker()
    debug('worker ready')
    onStatus?.('scanning')
    void this.scanOnce(onScan, onStatus)
    this.interval = window.setInterval(() => {
      void this.scanOnce(onScan, onStatus)
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
    this.lastSignature = null
    this.skipCount = 0
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
    // Ask main which display to capture (the one the cursor is on right
    // now) plus its CSS bounds + DPI so we can translate OCR pixel coords
    // into the virtual-screen CSS space the overlays understand.
    const target = await window.api?.liveAcquireTarget()
    if (target === undefined || target === null) {
      throw new Error('Capture cible introuvable — aucun écran disponible.')
    }
    this.target = target
    debug('target acquired:', target)

    // Electron's chromeMediaSource extension lets us pin getUserMedia to
    // a specific display source ID. This bypasses the system picker AND
    // any setDisplayMediaRequestHandler defaults, so the engine reliably
    // captures the display we want even on multi-monitor setups.
    const constraints: ElectronDesktopConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: target.sourceId,
        maxWidth: Math.floor(target.bounds.width * target.scaleFactor),
        maxHeight: Math.floor(target.bounds.height * target.scaleFactor)
      }
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // The Electron typings don't list `mandatory`; cast through unknown
      // so we don't have to weaken the public type elsewhere.
      video: constraints as unknown as MediaTrackConstraints
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
    debug(`video acquired: ${video.videoWidth}x${video.videoHeight}`)
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker !== null) return
    // Default to English; users can add 'fra' later via settings. Tesseract
    // downloads traineddata on first init (~3-5 MB cached after that).
    this.worker = await createWorker('eng')
    // PSM 11 = sparse text in no particular order. Way better than the
    // default PSM 3 for our use case: screenshots aren't documents, they
    // contain scattered UI labels + values, and PSM 11 finds them faster
    // AND with better accuracy than treating the screen as a page.
    // OEM 1 = LSTM only — already the default in tesseract.js v5 but
    // we make it explicit so future upgrades can't silently regress.
    await (this.worker as unknown as {
      setParameters: (p: Record<string, string>) => Promise<void>
    }).setParameters({
      tessedit_pageseg_mode: '11',
      tessedit_ocr_engine_mode: '1'
    })
  }

  /**
   * Cheap perceptual hash of the current video frame: render a 16×9
   * thumbnail and pull mean luminance per pixel. ~2 ms vs the 600-1500
   * ms a full OCR scan takes — so as long as the screen hasn't visibly
   * changed since last time, we can skip the OCR completely and let the
   * sticky pool on the Toolbar side keep the masks visible.
   *
   * Why luminance and not full RGB?
   *   - 1 byte/cell instead of 3 → smaller comparison
   *   - Mouse moves over the same content barely shift luminance
   *   - Catches real changes (new windows, scrolling, dialog popups)
   */
  private computeFrameSignature(video: HTMLVideoElement): Uint8Array | null {
    const ctx = this.sigCanvas.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return null
    ctx.drawImage(video, 0, 0, SIGNATURE_W, SIGNATURE_H)
    const pixels = ctx.getImageData(0, 0, SIGNATURE_W, SIGNATURE_H).data
    const sig = new Uint8Array(SIGNATURE_W * SIGNATURE_H)
    for (let i = 0; i < sig.length; i++) {
      const px = i * 4
      // ITU-R BT.601 luma. Cheaper than BT.709 and good enough at
      // 16×9 resolution.
      sig[i] = Math.round(
        0.299 * (pixels[px] ?? 0) +
          0.587 * (pixels[px + 1] ?? 0) +
          0.114 * (pixels[px + 2] ?? 0)
      )
    }
    return sig
  }

  private signaturesMatch(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > SIGNATURE_TOLERANCE) {
        return false
      }
    }
    return true
  }

  private async scanOnce(
    onScan?: (r: ScanResult) => void,
    onStatus?: (s: 'acquiring' | 'loading-ocr' | 'scanning' | 'idle') => void
  ): Promise<ScanResult | null> {
    if (this.video === null || this.worker === null) {
      debug('scanOnce skipped: no video/worker')
      return null
    }
    if (this.scanInFlight) return null

    // ---- Frame-stable shortcut --------------------------------------
    // If the screen looks identical to the last scan, skip the OCR
    // entirely. The Toolbar's sticky pool (15 s TTL) keeps any masks
    // from the last real scan visible, so the user sees zero change
    // and we save 600-1500 ms of CPU + worker memory churn.
    //
    // Safety net: even when the signature reports "no change", force a
    // real OCR every FORCE_OCR_EVERY_N_SKIPS ticks. A tiny secret typed
    // into one cell could get averaged out by the 16x9 thumbnail; the
    // forced pass guarantees worst-case 5 s detection latency.
    const sig = this.computeFrameSignature(this.video)
    const sigStable =
      sig !== null &&
      this.lastSignature !== null &&
      this.signaturesMatch(sig, this.lastSignature)
    if (sigStable && this.skipCount < FORCE_OCR_EVERY_N_SKIPS - 1) {
      this.skipCount++
      debug(`frame stable (skip #${this.skipCount}) — OCR avoided`)
      onStatus?.('idle')
      return null
    }
    if (sig !== null) this.lastSignature = sig
    if (sigStable) {
      debug(`forced OCR after ${this.skipCount} skips (anti-drift)`)
    }
    this.skipCount = 0
    // ----------------------------------------------------------------

    this.scanInFlight = true
    onStatus?.('scanning')
    const startedAt = performance.now()
    try {
      const { dataUrl, scaleX, scaleY } = this.captureFrameToDataUrl(this.video)
      if (dataUrl.length === 0) {
        debug('empty frame capture')
        return null
      }
      const result = await this.worker.recognize(dataUrl)
      const data = result.data as unknown as { text?: string; words?: TesseractWord[] }
      const words = Array.isArray(data.words) ? data.words : []
      const textPreview = (data.text ?? '').slice(0, 120).replace(/\s+/g, ' ').trim()
      // scaleX / scaleY here recover physical source pixels from the
      // downscaled OCR canvas. We then divide by the display's DPI scale
      // factor to land in CSS pixels, and finally offset by the display's
      // virtual-screen origin so the overlay can do a simple
      // `mask.x - window.screenX` translation.
      const masks = this.detectMasks(words, scaleX, scaleY)
      const ocrWords = this.wordsToCss(words, scaleX, scaleY)
      const dur = Math.round(performance.now() - startedAt)
      debug(
        `scan done: ${dur}ms · ${words.length} words · ${masks.length} hits · text="${textPreview}..."`
      )
      const out: ScanResult = {
        masks,
        ocrWords,
        preview: textPreview,
        wordCount: words.length,
        scanDurationMs: dur
      }
      onScan?.(out)
      onStatus?.('idle')
      return out
    } catch (err) {
      console.error('[sanitizer-live] scan failed, recovering worker:', err)
      // Worker is in an unknown state after a recognize() failure. Kill
      // it, then re-create immediately so the next interval tick has
      // something to run on. Sticky masks on the Toolbar side absorb
      // the 200-400 ms gap while createWorker() spins up.
      if (this.worker !== null) {
        try {
          await this.worker.terminate()
        } catch {
          // ignore — already dead
        }
        this.worker = null
      }
      // Also force a fresh signature so the next frame goes through OCR
      // even if it looks identical to the last good one.
      this.lastSignature = null
      // Best-effort respawn. If THIS also fails, the engine will keep
      // retrying on every interval tick until the user toggles LIVE.
      if (this.running) {
        try {
          await this.ensureWorker()
        } catch (respawnErr) {
          console.error(
            '[sanitizer-live] worker respawn failed, will retry next tick:',
            respawnErr
          )
        }
      }
      return null
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
    // JPEG q=0.6 is plenty for OCR — PNG was paying lossless encode
    // cost on every frame for nothing.
    return {
      dataUrl: this.canvas.toDataURL('image/jpeg', OCR_JPEG_QUALITY),
      scaleX: 1 / scale,
      scaleY: 1 / scale
    }
  }

  private detectMasks(words: TesseractWord[], scaleX: number, scaleY: number): LiveMask[] {
    if (words.length === 0) return []
    // To go from OCR pixel coords → virtual-screen CSS coords we need:
    //   1. (bbox * scaleX) — undo the OCR downscale → source physical pixels
    //   2. / scaleFactor  — undo the display DPI → display-local CSS pixels
    //   3. + bounds.{x,y} — offset by display origin in the virtual desktop
    // If we somehow ran without a target (programmer error), fall back to
    // the identity transform so masks at least appear on the primary
    // display rather than nowhere.
    const t = this.target
    const dpi = t?.scaleFactor ?? 1
    const offX = t?.bounds.x ?? 0
    const offY = t?.bounds.y ?? 0
    const toCssX = (px: number): number => (px * scaleX) / dpi + offX
    const toCssY = (px: number): number => (px * scaleY) / dpi + offY
    // Right edge of the captured display in virtual-screen CSS space.
    // Masks become horizontal stripes from the detected x position all
    // the way to this edge. Two reasons:
    //   1. OCR's bbox jitter between scans no longer pulls the mask off
    //      the secret — even if the new bbox shifts a few px right, the
    //      stripe still covers the original column.
    //   2. Most secrets sit at the end of a labeled line ("Token: xyz"
    //      or "Code: *****tuy6") with nothing useful to their right, so
    //      over-masking the trailing whitespace is harmless.
    const displayRightCss = offX + (t?.bounds.width ?? 0)

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
        // A small padding so the mask covers the letters fully
        const PAD = 4
        const cssX = toCssX(x0) - PAD
        const cssY = toCssY(y0) - PAD
        // Stripe to the right edge of the display rather than just
        // covering the matched word — absorbs OCR x-jitter completely.
        const cssW = Math.max(
          (x1 - x0) * scaleX / dpi + PAD * 2,
          displayRightCss - cssX
        )
        const cssH = (y1 - y0) * scaleY / dpi + PAD * 2
        masks.push({
          x: Math.floor(cssX),
          y: Math.floor(cssY),
          width: Math.ceil(cssW),
          height: Math.ceil(cssH),
          label: pattern.name
        })
        // Defend against pathological zero-width matches
        if (match[0].length === 0) pattern.regex.lastIndex += 1
      }
    }

    // Reassembly pass — Tesseract sometimes splits a single token at
    // its hyphens / underscores / dots. The spaced text above won't
    // contain "sk-proj-XYZ" if OCR returned ["sk-proj", "-XYZ"] as two
    // tokens. We re-test the patterns on a per-line text built WITHOUT
    // separators between adjacent words, recovering those splits. The
    // mergeOverlappingMasks call at the end dedupes any overlap with
    // the spaced pass.
    const linesGroups = groupWordsByLine(words)
    for (const lineWords of linesGroups) {
      let lineText = ''
      const lineRanges: Array<{ start: number; end: number; idx: number }> = []
      for (const lw of lineWords) {
        const start = lineText.length
        lineText += lw.word.text
        lineRanges.push({ start, end: lineText.length, idx: lw.idx })
      }
      if (lineText.length === 0) continue
      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.regex.exec(lineText)) !== null) {
          const ms = match.index
          const me = ms + match[0].length
          const touched = lineRanges.filter((r) => r.start < me && r.end > ms)
          if (touched.length === 0) {
            if (match[0].length === 0) pattern.regex.lastIndex += 1
            continue
          }
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
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
          const PAD = 4
          const cssX = toCssX(x0) - PAD
          const cssY = toCssY(y0) - PAD
          const cssW = Math.max(
            (x1 - x0) * scaleX / dpi + PAD * 2,
            displayRightCss - cssX
          )
          const cssH = (y1 - y0) * scaleY / dpi + PAD * 2
          masks.push({
            x: Math.floor(cssX),
            y: Math.floor(cssY),
            width: Math.ceil(cssW),
            height: Math.ceil(cssH),
            label: `joined:${pattern.name}`
          })
          if (match[0].length === 0) pattern.regex.lastIndex += 1
        }
      }
    }

    // Contextual pass — masks any 8+ char value that sits on the same
    // line as a secret-label keyword (secret / mot de passe / token /
    // credential / key / clé / etc., FR + EN). This catches things the
    // pure-regex pass misses, e.g. provider-specific formats we don't
    // explicitly enumerate, or values already partially redacted like
    // "****tuy6" that still need to be hidden because the LABEL right
    // next to them screams "this is a secret".
    const contextualMasks = this.contextual ? this.detectContextualSecrets(words) : []
    for (const ctxMask of contextualMasks) {
      const PAD = 4
      const cssX = toCssX(ctxMask.x0) - PAD
      const cssY = toCssY(ctxMask.y0) - PAD
      // Same stripe-to-right-edge trick as the regex pass above.
      const cssW = Math.max(
        (ctxMask.x1 - ctxMask.x0) * scaleX / dpi + PAD * 2,
        displayRightCss - cssX
      )
      const cssH = (ctxMask.y1 - ctxMask.y0) * scaleY / dpi + PAD * 2
      masks.push({
        x: Math.floor(cssX),
        y: Math.floor(cssY),
        width: Math.ceil(cssW),
        height: Math.ceil(cssH),
        label: `context:${ctxMask.label}`
      })
    }

    return mergeOverlappingMasks(masks)
  }

  /**
   * Translate every OCR word's bbox into virtual-screen CSS coordinates
   * (same space as window.screenX/Y) so the overlay can debug-render
   * them on top of any display in the right place.
   */
  private wordsToCss(
    words: TesseractWord[],
    scaleX: number,
    scaleY: number
  ): OcrWordBox[] {
    const t = this.target
    const dpi = t?.scaleFactor ?? 1
    const offX = t?.bounds.x ?? 0
    const offY = t?.bounds.y ?? 0
    const out: OcrWordBox[] = []
    for (const w of words) {
      if (!w || !w.bbox) continue
      const b = w.bbox
      out.push({
        x: Math.floor((b.x0 * scaleX) / dpi + offX),
        y: Math.floor((b.y0 * scaleY) / dpi + offY),
        width: Math.ceil((b.x1 - b.x0) * scaleX / dpi),
        height: Math.ceil((b.y1 - b.y0) * scaleY / dpi),
        text: w.text
      })
    }
    return out
  }

  /**
   * Look for secret-y label words (FR + EN) and mask the next 1-3 words
   * on the same line that look like a credential value. "Same line" is
   * baselines within half the keyword's height. "Credential-like" is
   * any 8+ char run of base64/url-safe/asterisk characters that is
   * neither a date nor a plain number AND mixes at least 2 character
   * classes (case + digits) so plain English/French words next to a
   * label don't get masked.
   */
  private detectContextualSecrets(
    words: TesseractWord[]
  ): Array<{ x0: number; y0: number; x1: number; y1: number; label: string }> {
    const KEYWORDS =
      /^(secret|secrets|password|passwords|mot|pwd|token|tokens|jeton|jetons|cle|clé|cles|clés|key|keys|credential|credentials|api[_-]?key|client[_-]?secret|access[_-]?token|bearer|auth)s?[:.;,]*$/i
    // A candidate value must look credential-shaped, NOT like a normal
    // word. Three rules combined:
    //   - VALUE_RE  : allowed character set, ≥8 chars (was 6 — too short
    //                 caught short codes that turned out to be IDs).
    //   - HAS_TOKEN_LIKE_CHAR : at least one digit OR one of _ - / + = . :
    //     Rules out plain French/English words like "personne" / "toute"
    //     that share a line with the word "secret" in a flowing sentence.
    //   - MIXES_CLASSES : >=2 of {upper, lower, digit}. Real tokens are
    //     random-looking; "Camelcase" or "lowercaseword" is probably text.
    const VALUE_RE = /^[A-Za-z0-9_\-./+=:*]{8,}$/
    const HAS_TOKEN_LIKE_CHAR = /[\d_\-./+=:*]/
    // Things that look like values but aren't credentials.
    const DATE_RE = /^\d{1,4}[-/]\d{1,2}([-/]\d{1,4})?$/
    const NUM_RE = /^\d+([.,]\d+)?$/
    const mixesClasses = (s: string): boolean => {
      let upper = 0, lower = 0, digit = 0
      for (const c of s) {
        if (c >= 'A' && c <= 'Z') upper = 1
        else if (c >= 'a' && c <= 'z') lower = 1
        else if (c >= '0' && c <= '9') digit = 1
      }
      return upper + lower + digit >= 2
    }
    const out: Array<{ x0: number; y0: number; x1: number; y1: number; label: string }> = []
    for (let i = 0; i < words.length; i++) {
      const kw = words[i]
      if (!kw || !kw.bbox) continue
      if (!KEYWORDS.test(kw.text)) continue
      const refY = (kw.bbox.y0 + kw.bbox.y1) / 2
      const lineTol = Math.max(8, (kw.bbox.y1 - kw.bbox.y0) * 0.5)
      // Scan up to 4 words to the right on the same horizontal line
      // (was 6 — the longer reach kept masking unrelated content
      // further down the sentence).
      let consumedNearbyKeyword = false
      for (let j = i + 1; j < Math.min(i + 5, words.length); j++) {
        const v = words[j]
        if (!v || !v.bbox) continue
        const vy = (v.bbox.y0 + v.bbox.y1) / 2
        if (Math.abs(vy - refY) > lineTol) break // dropped to next line
        // Skip filler keywords ("de", "du", "client") so "Code secret du
        // client *****tuy6" still ends up masking the actual value.
        const isFiller = /^(de|du|d[eu]?|le|la|les|of|the|client|user|api|le|du|pour|for)$/i.test(
          v.text
        )
        if (isFiller && !consumedNearbyKeyword) continue
        consumedNearbyKeyword = true
        if (!VALUE_RE.test(v.text)) continue
        if (!HAS_TOKEN_LIKE_CHAR.test(v.text)) continue
        if (DATE_RE.test(v.text) || NUM_RE.test(v.text)) continue
        if (!mixesClasses(v.text)) continue
        // Mask just this one value and stop — we don't want to keep
        // masking subsequent words on the same line.
        out.push({
          x0: v.bbox.x0,
          y0: v.bbox.y0,
          x1: v.bbox.x1,
          y1: v.bbox.y1,
          label: kw.text.toLowerCase().replace(/[:.;,]*$/, '')
        })
        break
      }
    }
    return out
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

/**
 * Cluster OCR words into visual lines based on Y proximity. Used by
 * the reassembly pass to join adjacent words that Tesseract may have
 * split apart inside a single token (typical at `-`, `_`, `.` chars).
 *
 * Each group keeps the original index into `words` so the mask
 * builder can still look up bboxes from the source array.
 */
function groupWordsByLine(
  words: TesseractWord[]
): Array<Array<{ word: TesseractWord; idx: number }>> {
  if (words.length === 0) return []
  const indexed = words
    .map((w, idx) => (w && w.bbox ? { word: w, idx } : null))
    .filter((v): v is { word: TesseractWord; idx: number } => v !== null)
  // Sort by Y so we can do a single pass and append to whichever line
  // the next word is closest to.
  indexed.sort((a, b) => a.word.bbox.y0 - b.word.bbox.y0)
  const lines: Array<Array<{ word: TesseractWord; idx: number }>> = []
  for (const it of indexed) {
    const yC = (it.word.bbox.y0 + it.word.bbox.y1) / 2
    const h = it.word.bbox.y1 - it.word.bbox.y0
    const tol = Math.max(8, h * 0.5)
    // Look at the most recent line — words come pre-sorted by Y, so
    // anything new will land in the last line or start a new one.
    const last = lines[lines.length - 1]
    if (last !== undefined) {
      const ref = last[last.length - 1]
      if (ref !== undefined) {
        const refYc = (ref.word.bbox.y0 + ref.word.bbox.y1) / 2
        if (Math.abs(refYc - yC) <= tol) {
          last.push(it)
          continue
        }
      }
    }
    lines.push([it])
  }
  // X-sort within each line so concatenation reflects reading order.
  for (const line of lines) {
    line.sort((a, b) => a.word.bbox.x0 - b.word.bbox.x0)
  }
  return lines
}
