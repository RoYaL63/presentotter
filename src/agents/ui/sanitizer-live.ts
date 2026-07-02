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

/** A text-bearing UI element read by the native UI-Automation scanner:
 *  its full text + on-screen rect already in virtual-screen CSS (DIP). */
export interface UiaTextElement {
  text: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Detection for the UI-Automation path. Each element carries the COMPLETE
 * text of a field, so detection is a direct regex/entropy test (no OCR word
 * reassembly). A hit masks the whole field rect — exactly what we want for a
 * credential typed/pasted into an input. Runs in the renderer so it reuses
 * the canonical PATTERNS (keeping the main process free of business logic,
 * which also keeps its tsc output structure intact).
 */
export function detectMasksFromElements(elements: UiaTextElement[]): LiveMask[] {
  const masks: LiveMask[] = []
  for (const el of elements) {
    const text = typeof el.text === 'string' ? el.text : ''
    if (text.trim().length < 4) continue
    let label: string | null = null
    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0
      if (pattern.regex.test(text)) {
        label = pattern.name
        break
      }
    }
    if (label === null) {
      for (const token of text.split(/\s+/)) {
        if (looksLikeSecretToken(token)) {
          label = 'entropy'
          break
        }
      }
    }
    if (label === null) continue
    masks.push({
      x: Math.floor(el.x),
      y: Math.floor(el.y),
      width: Math.ceil(el.width),
      height: Math.ceil(el.height),
      label: `uia:${label}`
    })
  }
  return mergeOverlappingMasks(masks)
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

// Scan at (near) native resolution. Downscaling to 960 px (the old
// "fast" value) shrank small text — API-key fields use a compact
// monospace font that, after a 2-4x downscale on a hi-res screen,
// dropped below Tesseract's readable threshold and was silently NOT
// read (confirmed via the OCR debug overlay: every label was boxed,
// the sk-proj- token was not). 2200 keeps 1080p/1440p screens at native
// and only mildly downscales 4K, so small credential text stays
// legible. OCR is in a worker + gated by the frame-hash skip, so the
// extra cost only hits on actual screen changes.
const MAX_SCAN_WIDTH = 2200
// 100 ms cadence (was 250 ms) means the engine notices a frame change
// in a tenth of a second. Hash check is ~3 ms so the extra ticks cost
// almost nothing — the heavy OCR only runs when something actually
// changed, and the pre-shield covers the changed region the instant
// the change is noticed (before OCR even starts).
const DEFAULT_INTERVAL_MS = 100
// Fingerprint grid. 48×27 = 1296 cells (was 16×9 = 144). The finer grid
// is what makes the engine FAST: a freshly-pasted key only changes a few
// cells, so we can OCR just that small region instead of the whole screen.
// getImageData on a 48×27 thumbnail is still well under a millisecond.
const SIGNATURE_W = 48
const SIGNATURE_H = 27
// Per-cell luminance delta tolerated as "no visible change". 10 ≈ 4% of
// the 0-255 range — small mouse moves / AA jitter pass, real content
// changes (a key appearing, scrolling, a new window) get caught.
const SIGNATURE_TOLERANCE = 10
// Most scans OCR only the rectangle that changed since the last OCR (tiny
// → fast). Periodically we still OCR the WHOLE frame so the sticky-mask
// pool is refreshed and the contextual/entropy passes see the full screen
// (a label off to the side of the changed region, etc.).
const FORCE_FULL_OCR_AFTER_MS = 4000
// Pad the changed region by a couple of cells so glyphs straddling a cell
// edge stay fully inside the cropped OCR input.
const REGION_PAD_CELLS = 2
// Pre-shield: the instant a frame change is detected, the changed region
// is masked (opaque overlay) while the OCR runs. This closes the
// screenshot window: a freshly-pasted key is covered within one tick
// (~100 ms) instead of staying visible for the 300-1500 ms an OCR pass
// takes. The shield is lifted (or replaced by a tight mask) as soon as
// the scan completes. Changes bigger than this fraction of the frame
// (scrolling, window switches) skip the shield — flashing a full-screen
// blackout 10× per second while scrolling would make the tool unusable,
// and big repaints are almost never "a secret just appeared".
const PRESHIELD_MAX_AREA_RATIO = 0.45
// JPEG quality used for the OCR input. 0.6 was too aggressive: it
// blurred small monospace token text into unreadable mush. 0.9 keeps
// the glyph edges crisp for Tesseract while still being far cheaper
// than lossless PNG.
const OCR_JPEG_QUALITY = 0.9

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
  /** Wall-clock ts of the last FULL-frame OCR. Drives the periodic full
   *  rescan that refreshes the sticky pool between region-only scans. */
  private lastFullOcrAt = 0
  private interval: number | null = null
  private running = false
  private scanInFlight = false
  private target: CaptureTarget | null = null
  /** Whether to run the label-based contextual detection pass on top
   *  of the regex pass. Toggleable live via setContextual(). */
  private contextual = true
  /** Whether to raise a provisional mask over a changed region while
   *  the OCR analyses it. Toggleable live via setPreShield(). */
  private preShield = true
  /** Callback used to raise the pre-shield mask (set at start()). */
  private onShield: ((mask: LiveMask) => void) | null = null

  constructor() {
    this.canvas = document.createElement('canvas')
    this.sigCanvas = document.createElement('canvas')
    this.sigCanvas.width = SIGNATURE_W
    this.sigCanvas.height = SIGNATURE_H
  }

  setContextual(enabled: boolean): void {
    this.contextual = enabled
  }

  setPreShield(enabled: boolean): void {
    this.preShield = enabled
  }

  /** Start the periodic scan loop. Idempotent. */
  async start(
    intervalMs: number = DEFAULT_INTERVAL_MS,
    onScan?: (r: ScanResult) => void,
    onStatus?: (s: 'acquiring' | 'loading-ocr' | 'scanning' | 'idle') => void,
    onShield?: (mask: LiveMask) => void
  ): Promise<void> {
    if (this.running) return
    this.running = true
    this.onShield = onShield ?? null
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
    this.lastFullOcrAt = 0
    this.onShield = null
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

  /**
   * If the cursor has moved to a different display since we acquired the
   * capture, tear the stream down and re-acquire for the new display.
   * Cheap check (one IPC returning a display id) every scan; the
   * expensive getUserMedia only runs on an actual screen change. This
   * is what makes the sanitizer follow the user across monitors.
   */
  private async switchDisplayIfNeeded(): Promise<void> {
    if (this.target === null) return
    let cur: number | undefined
    try {
      cur = await window.api?.liveCursorDisplayId()
    } catch {
      return // IPC unavailable — keep current capture
    }
    if (cur === undefined || cur === this.target.displayId) return
    debug(`cursor moved to display ${cur} (was ${this.target.displayId}) — re-acquiring`)
    if (this.stream !== null) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    if (this.video !== null) {
      this.video.srcObject = null
      this.video = null
    }
    this.lastSignature = null
    this.lastFullOcrAt = 0
    await this.acquireStream()
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

  private async scanOnce(
    onScan?: (r: ScanResult) => void,
    onStatus?: (s: 'acquiring' | 'loading-ocr' | 'scanning' | 'idle') => void
  ): Promise<ScanResult | null> {
    if (this.worker === null) {
      debug('scanOnce skipped: no worker')
      return null
    }
    if (this.scanInFlight) return null
    this.scanInFlight = true
    try {
      // ---- Multi-monitor: follow the cursor's display ---------------
      // The capture is pinned to one display. If the user moved to a
      // different screen, re-acquire so we scan the screen they're
      // actually looking at (otherwise the sanitizer silently watches
      // the wrong monitor — the #1 "it doesn't work" cause on multi-
      // screen setups).
      await this.switchDisplayIfNeeded()
      if (this.video === null || this.worker === null) {
        return null
      }

      // ---- Changed-region shortcut ---------------------------------
      // Compare a fine luminance fingerprint to the last OCR'd frame.
      //   - nothing changed + no full rescan due → skip (sticky pool holds)
      //   - something changed → OCR ONLY the rectangle that changed (small
      //     → fast → a freshly-pasted key is masked in well under a second)
      //   - periodically → OCR the whole frame (refresh pool + run the
      //     contextual/entropy passes over the full screen)
      const now = performance.now()
      const sig = this.computeFrameSignature(this.video)
      const forceFull =
        this.lastSignature === null ||
        now - this.lastFullOcrAt >= FORCE_FULL_OCR_AFTER_MS
      // Changed-cell bounds are computed on EVERY tick (not only on the
      // region path) so the pre-shield can also fire when the change
      // happens to land on a forced-full-scan tick.
      const changed =
        sig !== null && this.lastSignature !== null
          ? changedCellsBounds(
              sig,
              this.lastSignature,
              SIGNATURE_W,
              SIGNATURE_H,
              SIGNATURE_TOLERANCE
            )
          : null
      let region: { x: number; y: number; width: number; height: number } | null =
        null
      if (!forceFull) {
        if (changed === null) {
          debug('frame stable — skipping OCR')
          onStatus?.('idle')
          return null
        }
        region = cellsToRegion(
          changed,
          this.video.videoWidth,
          this.video.videoHeight
        )
      }
      // ---- Pre-shield -----------------------------------------------
      // Something changed on screen and we're about to spend 100-1500 ms
      // OCR'ing it. Cover the changed area RIGHT NOW so a secret that
      // just appeared is never visible in a screen-share while the OCR
      // decides whether it's sensitive. Big repaints (scroll, window
      // switch) skip the shield — see PRESHIELD_MAX_AREA_RATIO.
      if (changed !== null && this.preShield && this.onShield !== null) {
        const shieldRegion =
          region ??
          cellsToRegion(changed, this.video.videoWidth, this.video.videoHeight)
        const frameArea = this.video.videoWidth * this.video.videoHeight
        const shieldArea = shieldRegion.width * shieldRegion.height
        if (shieldArea <= frameArea * PRESHIELD_MAX_AREA_RATIO) {
          this.onShield(this.regionToCssMask(shieldRegion))
        }
      }
      // This frame becomes the new baseline once we commit to OCR'ing it.
      if (sig !== null) this.lastSignature = sig
      if (region === null) this.lastFullOcrAt = now
      // --------------------------------------------------------------

      onStatus?.('scanning')
      const startedAt = performance.now()
      const { dataUrl, scaleX, scaleY, offsetX, offsetY } =
        this.captureFrameToDataUrl(this.video, region)
      if (dataUrl.length === 0) {
        debug('empty frame capture')
        return null
      }
      // tesseract.js v5.1+ STOPPED returning the word hierarchy by
      // default — `data.words` is undefined unless we explicitly ask for
      // `blocks: true` in the output options. Without this the words
      // array was always empty and the sanitizer produced ZERO masks
      // ("rien ne fonctionne"). We request blocks and, as a belt-and-
      // suspenders, flatten the block→paragraph→line→word tree if the
      // flat `data.words` accessor is missing.
      const result = await this.worker.recognize(
        dataUrl,
        {},
        { blocks: true } as unknown as undefined
      )
      const data = result.data as unknown as {
        text?: string
        words?: TesseractWord[]
        blocks?: Array<{
          paragraphs?: Array<{
            lines?: Array<{ words?: TesseractWord[] }>
          }>
        }>
      }
      let words = Array.isArray(data.words) ? data.words : []
      if (words.length === 0 && Array.isArray(data.blocks)) {
        words = flattenBlocksToWords(data.blocks)
      }
      // Region OCR returns bboxes relative to the crop. Fold the crop
      // offset back in (in OCR-canvas units: offset / scale) so every
      // downstream transform (detectMasks, wordsToCss) stays identical to
      // the full-frame path. For a full scan offset is 0 → no-op.
      if (offsetX !== 0 || offsetY !== 0) {
        const addX = offsetX / scaleX
        const addY = offsetY / scaleY
        for (const w of words) {
          if (!w || !w.bbox) continue
          w.bbox.x0 += addX
          w.bbox.x1 += addX
          w.bbox.y0 += addY
          w.bbox.y1 += addY
        }
      }
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

  /**
   * Convert a changed-region rectangle (source physical pixels of the
   * captured display) into a virtual-screen CSS mask for the pre-shield.
   * Same transform as detectMasks minus the OCR-canvas scale (regions
   * are already in source pixels).
   */
  private regionToCssMask(r: {
    x: number
    y: number
    width: number
    height: number
  }): LiveMask {
    const t = this.target
    const dpi = t?.scaleFactor ?? 1
    const offX = t?.bounds.x ?? 0
    const offY = t?.bounds.y ?? 0
    return {
      x: Math.floor(r.x / dpi + offX),
      y: Math.floor(r.y / dpi + offY),
      width: Math.ceil(r.width / dpi),
      height: Math.ceil(r.height / dpi),
      label: 'analyse…'
    }
  }

  private captureFrameToDataUrl(
    video: HTMLVideoElement,
    region?: { x: number; y: number; width: number; height: number } | null
  ): {
    dataUrl: string
    scaleX: number
    scaleY: number
    offsetX: number
    offsetY: number
  } {
    // Crop to the changed region when given one (fast path), else the
    // whole frame. Coordinates are SOURCE pixels of the captured display.
    const srcX = region?.x ?? 0
    const srcY = region?.y ?? 0
    const srcW = region?.width ?? video.videoWidth
    const srcH = region?.height ?? video.videoHeight
    const scale = srcW > MAX_SCAN_WIDTH ? MAX_SCAN_WIDTH / srcW : 1
    const dstW = Math.max(1, Math.floor(srcW * scale))
    const dstH = Math.max(1, Math.floor(srcH * scale))
    this.canvas.width = dstW
    this.canvas.height = dstH
    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      return { dataUrl: '', scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }
    }
    // Boost contrast + force grayscale BEFORE Tesseract sees the
    // pixels. Modern dark-mode UIs (OpenAI, Notion, Linear, Discord…)
    // render small mono-space tokens in low-contrast grey-on-grey,
    // which Tesseract struggles to read at our 960 px scan width.
    // Applying a 1.8× contrast + grayscale at draw time turns the
    // text into something close to black-on-white, where the LSTM
    // engine is most reliable. ctx.filter is GPU-accelerated in
    // Chromium so the cost is sub-millisecond vs the 30-50% OCR
    // accuracy bump it buys on dark UIs.
    ctx.filter = 'grayscale(1) contrast(1.8) brightness(0.95)'
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH)
    ctx.filter = 'none'
    // scaleX/Y recover source pixels from the downscaled OCR canvas;
    // offsetX/Y are the crop origin in source pixels (0 for a full frame).
    return {
      dataUrl: this.canvas.toDataURL('image/jpeg', OCR_JPEG_QUALITY),
      scaleX: 1 / scale,
      scaleY: 1 / scale,
      offsetX: srcX,
      offsetY: srcY
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
    // Masks are TIGHT: they cover the matched words' bbox + MASK_PAD only,
    // never more. The old stripe-to-the-right-edge behaviour over-masked
    // everything to the right of a secret; scan-to-scan bbox jitter is
    // absorbed by the slightly larger pad + the sticky pool's overlap
    // matching on the toolbar side instead.
    const MASK_PAD = 6

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
        const cssX = toCssX(x0) - MASK_PAD
        const cssY = toCssY(y0) - MASK_PAD
        const cssW = (x1 - x0) * scaleX / dpi + MASK_PAD * 2
        const cssH = (y1 - y0) * scaleY / dpi + MASK_PAD * 2
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
          const cssX = toCssX(x0) - MASK_PAD
          const cssY = toCssY(y0) - MASK_PAD
          const cssW = (x1 - x0) * scaleX / dpi + MASK_PAD * 2
          const cssH = (y1 - y0) * scaleY / dpi + MASK_PAD * 2
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
      const cssX = toCssX(ctxMask.x0) - MASK_PAD
      const cssY = toCssY(ctxMask.y0) - MASK_PAD
      const cssW = (ctxMask.x1 - ctxMask.x0) * scaleX / dpi + MASK_PAD * 2
      const cssH = (ctxMask.y1 - ctxMask.y0) * scaleY / dpi + MASK_PAD * 2
      masks.push({
        x: Math.floor(cssX),
        y: Math.floor(cssY),
        width: Math.ceil(cssW),
        height: Math.ceil(cssH),
        label: `context:${ctxMask.label}`
      })
    }

    // Generic shape pass — mask ANY OCR word that *looks* like a secret
    // by its shape alone (long, high-entropy, mixed character classes),
    // regardless of a known provider prefix or a nearby label. This is
    // what catches "a key-shaped string in a chat or on a random site"
    // that the regex + contextual passes miss. Tuned to skip URLs,
    // file paths, and ordinary prose so it doesn't mask the whole
    // screen. Only runs when contextual detection is on (same "be
    // aggressive" intent).
    if (this.contextual) {
      for (const w of words) {
        if (!w || !w.bbox) continue
        if (!looksLikeSecretToken(w.text)) continue
        const cssX = toCssX(w.bbox.x0) - MASK_PAD
        const cssY = toCssY(w.bbox.y0) - MASK_PAD
        const cssW = (w.bbox.x1 - w.bbox.x0) * scaleX / dpi + MASK_PAD * 2
        const cssH = (w.bbox.y1 - w.bbox.y0) * scaleY / dpi + MASK_PAD * 2
        masks.push({
          x: Math.floor(cssX),
          y: Math.floor(cssY),
          width: Math.ceil(cssW),
          height: Math.ceil(cssH),
          label: 'entropy'
        })
      }
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
 * Bounding box (in signature-grid cells, inclusive) of every cell whose
 * luminance changed by more than `tol` between two frame signatures, or
 * null if nothing changed. Drives the "OCR only the changed region" fast
 * path: a freshly-pasted key lights up a handful of cells we then crop to.
 */
function changedCellsBounds(
  cur: Uint8Array,
  last: Uint8Array,
  cols: number,
  rows: number,
  tol: number
): { minC: number; minR: number; maxC: number; maxR: number } | null {
  let minC = Infinity
  let minR = Infinity
  let maxC = -Infinity
  let maxR = -Infinity
  let any = false
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (Math.abs((cur[i] ?? 0) - (last[i] ?? 0)) > tol) {
        any = true
        if (c < minC) minC = c
        if (c > maxC) maxC = c
        if (r < minR) minR = r
        if (r > maxR) maxR = r
      }
    }
  }
  return any ? { minC, minR, maxC, maxR } : null
}

/**
 * Convert a changed-cell bounding box (signature grid) into a padded
 * pixel rectangle on the source frame, clamped to its bounds.
 */
function cellsToRegion(
  cells: { minC: number; minR: number; maxC: number; maxR: number },
  videoW: number,
  videoH: number
): { x: number; y: number; width: number; height: number } {
  const cellW = videoW / SIGNATURE_W
  const cellH = videoH / SIGNATURE_H
  const x0 = Math.max(0, (cells.minC - REGION_PAD_CELLS) * cellW)
  const y0 = Math.max(0, (cells.minR - REGION_PAD_CELLS) * cellH)
  const x1 = Math.min(videoW, (cells.maxC + 1 + REGION_PAD_CELLS) * cellW)
  const y1 = Math.min(videoH, (cells.maxR + 1 + REGION_PAD_CELLS) * cellH)
  return {
    x: Math.floor(x0),
    y: Math.floor(y0),
    width: Math.max(1, Math.ceil(x1 - x0)),
    height: Math.max(1, Math.ceil(y1 - y0))
  }
}

/**
 * Flatten Tesseract's block → paragraph → line → word tree into a flat
 * word array. Needed because tesseract.js v5.1+ only returns the
 * hierarchy (via `blocks: true`), not the convenient flat `data.words`.
 */
function flattenBlocksToWords(
  blocks: Array<{
    paragraphs?: Array<{ lines?: Array<{ words?: TesseractWord[] }> }>
  }>
): TesseractWord[] {
  const out: TesseractWord[] = []
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          if (w && w.bbox) out.push(w)
        }
      }
    }
  }
  return out
}

/** Shannon entropy in bits/char of a string. Random tokens score high
 *  (~4+), natural words and repeated chars score low. */
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  let h = 0
  const n = s.length
  for (const count of freq.values()) {
    const p = count / n
    h -= p * Math.log2(p)
  }
  return h
}

/**
 * Heuristic "does this OCR word look like an API key / token / secret"
 * by SHAPE only — no provider prefix, no nearby label needed. This is
 * the safety net that catches credentials in formats we don't enumerate
 * and contexts we can't label (a token pasted in a chat, shown on a
 * random dashboard, etc.).
 *
 * The bar is deliberately high to avoid masking ordinary text:
 *   - 18+ chars (real keys are long; this skips most words/IDs)
 *   - allowed charset only (base64 / url-safe / common separators)
 *   - at least one digit AND at least one letter (rules out words and
 *     pure numbers / hex-looking IDs that are usually not secrets)
 *   - Shannon entropy ≥ 3.5 bits/char (random-looking, not "aaaaaa…"
 *     or "----------")
 *   - not a URL / path / email (those have their own handling and are
 *     usually fine to show)
 */
function looksLikeSecretToken(raw: string): boolean {
  const s = raw.trim()
  if (s.length < 18 || s.length > 200) return false
  // Charset gate: only token-ish characters allowed end-to-end.
  if (!/^[A-Za-z0-9_\-./+=:~]+$/.test(s)) return false
  // Skip obvious non-secrets that pass the charset gate.
  if (/^https?:\/\//i.test(s)) return false // URL
  if (/^[\w.-]+@[\w.-]+$/.test(s)) return false // email
  if (s.includes('/') && s.split('/').length > 3) return false // path-ish
  if (/^[0-9.,]+$/.test(s)) return false // pure number
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) {
    // UUIDs are common, low-risk identifiers; let the regex catalog
    // decide if a specific one matters rather than blanket-masking.
    return false
  }
  const hasDigit = /\d/.test(s)
  const hasLetter = /[A-Za-z]/.test(s)
  if (!hasDigit || !hasLetter) return false
  if (shannonEntropy(s) < 3.5) return false
  return true
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
