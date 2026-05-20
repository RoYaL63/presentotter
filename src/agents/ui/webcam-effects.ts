import { FilesetResolver, ImageSegmenter, type MPMask } from '@mediapipe/tasks-vision'

/**
 * Webcam background effects — blur, image replacement, solid color.
 *
 * Pipeline per frame:
 *   1. Run MediaPipe's selfie_segmenter on the live webcam frame to
 *      produce a confidence mask (per-pixel probability of being
 *      foreground / person).
 *   2. Convert the Float32 mask into an ImageData whose alpha channel
 *      mirrors the mask values, then upload it to a small mask canvas.
 *   3. On a working canvas at webcam resolution:
 *        - Paint the chosen background (blurred webcam | image | color)
 *        - Draw the webcam frame
 *        - Apply the mask via globalCompositeOperation = 'destination-in'
 *          so only the person remains
 *        - Composite the person OVER the background, smoothly blended
 *   4. The resulting canvas is what the main RecordingPanel composer
 *      draws as the PiP. No changes needed downstream.
 *
 * The WASM + .tflite are bundled in src/renderer/public/mediapipe/ so
 * the feature works offline. Loading is lazy — the segmenter only
 * spins up when the user picks Blur / Image / Color.
 */

export type CamBgMode = 'none' | 'blur' | 'image' | 'color'
export type BlurIntensity = 'light' | 'medium' | 'strong'

export interface WebcamEffectsRefs {
  modeRef: React.MutableRefObject<CamBgMode>
  blurRef: React.MutableRefObject<BlurIntensity>
  imageBitmapRef: React.MutableRefObject<ImageBitmap | null>
  colorRef: React.MutableRefObject<string>
}

const BLUR_PX: Record<BlurIntensity, number> = {
  light: 8,
  medium: 16,
  strong: 28
}

/** Resolution we run the segmenter at — selfie_segmenter is tuned for
 *  ~256 px inputs. Lower → faster, mask gets blockier. 256 is the
 *  documented sweet spot. */
const SEG_INPUT_EDGE = 256

let cachedSegmenter: ImageSegmenter | null = null
let segmenterLoading: Promise<ImageSegmenter> | null = null

async function getSegmenter(): Promise<ImageSegmenter> {
  if (cachedSegmenter !== null) return cachedSegmenter
  if (segmenterLoading !== null) return segmenterLoading
  segmenterLoading = (async () => {
    const vision = await FilesetResolver.forVisionTasks('mediapipe')
    const seg = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'mediapipe/selfie_segmenter.tflite',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false
    })
    cachedSegmenter = seg
    return seg
  })()
  try {
    return await segmenterLoading
  } finally {
    segmenterLoading = null
  }
}

export interface WebcamEffectsProcessor {
  /** Canvas the main composer should draw as the PiP source. */
  canvas: HTMLCanvasElement
  /** Tear down the rAF loop. */
  stop(): void
}

/**
 * Build a processor that wraps the live webcam stream with optional
 * background blur / replace / solid color. When mode === 'none' the
 * canvas just mirrors the webcam frame (no segmentation work).
 */
export async function startWebcamEffects(
  video: HTMLVideoElement,
  refs: WebcamEffectsRefs
): Promise<WebcamEffectsProcessor> {
  // Wait for the source to have decoded a frame so videoWidth/height
  // are real numbers.
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      const h = () => {
        if (video.readyState >= 2) {
          video.removeEventListener('loadeddata', h)
          video.removeEventListener('canplay', h)
          resolve()
        }
      }
      video.addEventListener('loadeddata', h)
      video.addEventListener('canplay', h)
      window.setTimeout(resolve, 1500)
    })
  }

  const outW = video.videoWidth > 0 ? video.videoWidth : 1280
  const outH = video.videoHeight > 0 ? video.videoHeight : 720

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })
  if (ctx === null) throw new Error('Impossible de créer le contexte 2D webcam effects.')

  // A dedicated mask canvas, sized to the segmenter's input. We upscale
  // it to the webcam resolution when masking — cheap because the GPU
  // does it with bilinear filtering.
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = SEG_INPUT_EDGE
  maskCanvas.height = SEG_INPUT_EDGE
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (maskCtx === null) throw new Error('Impossible de créer le contexte 2D mask.')

  // Working canvas for person extraction (draws webcam + applies mask).
  const personCanvas = document.createElement('canvas')
  personCanvas.width = outW
  personCanvas.height = outH
  const personCtx = personCanvas.getContext('2d')
  if (personCtx === null) throw new Error('Impossible de créer le contexte 2D person.')

  let segmenter: ImageSegmenter | null = null
  let raf = 0
  let running = true

  // Kick off the segmenter load in the background — the first few
  // frames will be raw passthrough until it's ready, no flash.
  void getSegmenter()
    .then((s) => {
      segmenter = s
    })
    .catch((err) => {
      console.error('[webcam-effects] segmenter load failed:', err)
    })

  const draw = (): void => {
    if (!running) return
    const mode = refs.modeRef.current

    if (mode === 'none' || segmenter === null) {
      // Passthrough — draw the raw video.
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, outW, outH)
      }
      raf = requestAnimationFrame(draw)
      return
    }

    // 1. Segment the current frame
    let confidenceMask: MPMask | null = null
    try {
      const result = segmenter.segmentForVideo(video, performance.now())
      const masks = result.confidenceMasks
      if (masks !== undefined && masks.length > 0) {
        // selfie_segmenter ships a single confidence mask: probability of
        // the pixel being PERSON (foreground).
        confidenceMask = masks[0] ?? null
      }
    } catch (err) {
      console.warn('[webcam-effects] segment failed:', err)
    }

    if (confidenceMask === null) {
      // Segmenter hiccup — fall back to passthrough this frame so we
      // never flash an empty canvas.
      ctx.drawImage(video, 0, 0, outW, outH)
      raf = requestAnimationFrame(draw)
      return
    }

    // 2. Mask → ImageData on the small mask canvas
    const arr = confidenceMask.getAsFloat32Array()
    const mw = confidenceMask.width
    const mh = confidenceMask.height
    // Use the small maskCanvas dimensions as the ImageData size (they
    // should always match, but defend if the model returns something
    // unexpected).
    if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
      maskCanvas.width = mw
      maskCanvas.height = mh
    }
    const maskImageData = maskCtx.createImageData(mw, mh)
    const md = maskImageData.data
    for (let i = 0; i < arr.length; i++) {
      const a = Math.floor(((arr[i] ?? 0) as number) * 255)
      const j = i * 4
      md[j] = 255
      md[j + 1] = 255
      md[j + 2] = 255
      md[j + 3] = a
    }
    maskCtx.putImageData(maskImageData, 0, 0)
    confidenceMask.close()

    // 3. Paint background on the OUTPUT canvas
    paintBackground(ctx, outW, outH, video, refs)

    // 4. Build the person-only image on the working canvas
    personCtx.clearRect(0, 0, outW, outH)
    personCtx.drawImage(video, 0, 0, outW, outH)
    personCtx.save()
    personCtx.globalCompositeOperation = 'destination-in'
    // Upscale the small mask to webcam resolution; bilinear smoothing
    // gives a clean person edge.
    personCtx.imageSmoothingEnabled = true
    personCtx.imageSmoothingQuality = 'high'
    personCtx.drawImage(maskCanvas, 0, 0, outW, outH)
    personCtx.restore()

    // 5. Composite person over the background
    ctx.drawImage(personCanvas, 0, 0, outW, outH)

    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  return {
    canvas,
    stop(): void {
      running = false
      cancelAnimationFrame(raf)
    }
  }
}

/**
 * Paint the chosen background mode onto the output canvas before the
 * person is composited on top.
 */
function paintBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  video: HTMLVideoElement,
  refs: WebcamEffectsRefs
): void {
  const mode = refs.modeRef.current
  if (mode === 'blur') {
    const px = BLUR_PX[refs.blurRef.current]
    ctx.save()
    // Canvas `filter` is well supported in Chromium → Electron.
    ctx.filter = `blur(${px}px)`
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, w, h)
    } else {
      ctx.fillStyle = '#0D3548'
      ctx.fillRect(0, 0, w, h)
    }
    ctx.restore()
    return
  }
  if (mode === 'image' && refs.imageBitmapRef.current !== null) {
    const bmp = refs.imageBitmapRef.current
    const scale = Math.max(w / bmp.width, h / bmp.height)
    const bw = bmp.width * scale
    const bh = bmp.height * scale
    ctx.drawImage(bmp, (w - bw) / 2, (h - bh) / 2, bw, bh)
    return
  }
  if (mode === 'color') {
    ctx.fillStyle = refs.colorRef.current
    ctx.fillRect(0, 0, w, h)
    return
  }
  // Fallback: deep-sea fill (should never happen, mode === 'none'
  // is handled before we call this).
  ctx.fillStyle = '#0D3548'
  ctx.fillRect(0, 0, w, h)
}

/**
 * Free the cached segmenter. Call when the app shuts down or if the
 * user disables the feature for the whole session.
 */
export function disposeWebcamSegmenter(): void {
  if (cachedSegmenter !== null) {
    try {
      cachedSegmenter.close()
    } catch {
      /* ignore */
    }
    cachedSegmenter = null
  }
}
