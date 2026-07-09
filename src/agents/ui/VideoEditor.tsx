import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Blend,
  Check,
  Copy,
  Crop,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  ZoomIn
} from 'lucide-react'

/**
 * VideoEditor — post-production window.
 *
 * Data model: an ORDERED list of clips (source ranges). Order matters and a
 * range may appear twice — that's how "Dupliquer" replays a passage. Cutting
 * subtracts a range from every clip; playback walks the clip list in order,
 * jumping over the gaps; export sends the list as-is to ffmpeg.
 *
 * Ruler interactions:
 *   - plain CLICK        → seek + play from there (no need to rewatch)
 *   - press + DRAG       → select a zone (then cut or duplicate it)
 *   - press near a handle→ adjust that handle (generous grab zone)
 *   - hover              → time bubble under the cursor
 *
 * MediaRecorder WebM quirk (duration === Infinity) is handled by the probe
 * phase — see onLoadedMetadata.
 */

type Phase = 'loading' | 'probing' | 'ready' | 'exporting' | 'done' | 'error'

interface Range {
  start: number
  end: number
}

/** On-video text element. Position/size are FRACTIONS of the frame so the
 *  preview (scaled) and the export (native resolution) land identically. */
interface TextItem {
  id: number
  text: string
  /** Anchor point (center of the text), 0..1 of frame width/height. */
  x: number
  y: number
  /** Font size as a percentage of the frame HEIGHT. */
  sizePct: number
  color: string
  /** Visibility window, source time. */
  start: number
  end: number
}

const TEXT_COLORS = ['#FFFFFF', '#FFC857', '#3BE6C0', '#FF8B7B', '#0A1F1B'] as const

interface Pt {
  x: number
  y: number
}

/** On-video shape (rectangle to frame something, arrow to point at it). Two
 *  endpoints in frame FRACTIONS + stroke as a % of frame height, so preview
 *  and native-resolution export match. */
interface ShapeItem {
  id: number
  kind: 'rect' | 'arrow'
  from: Pt
  to: Pt
  color: string
  /** Stroke width as a percentage of the frame HEIGHT. */
  strokePct: number
  /** Rectangles only: translucent fill under the outline. */
  filled: boolean
  start: number
  end: number
}

/** Draw a filled arrowhead at `to`, pointing along from→to. */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  stroke: number
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const len = Math.max(stroke * 4, 14)
  const spread = Math.PI / 7
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - len * Math.cos(angle - spread), to.y - len * Math.sin(angle - spread))
  ctx.lineTo(to.x - len * Math.cos(angle + spread), to.y - len * Math.sin(angle + spread))
  ctx.closePath()
  ctx.fill()
}

/** SVG polygon points for an arrowhead at (tx,ty) pointing along from→to. */
function arrowHeadPoints(fx: number, fy: number, tx: number, ty: number, len: number): string {
  const angle = Math.atan2(ty - fy, tx - fx)
  const spread = Math.PI / 7
  const ax = tx - len * Math.cos(angle - spread)
  const ay = ty - len * Math.sin(angle - spread)
  const bx = tx - len * Math.cos(angle + spread)
  const by = ty - len * Math.sin(angle + spread)
  return `${tx},${ty} ${ax},${ay} ${bx},${by}`
}

/** Rasterize a shape to a full-frame transparent PNG at native resolution.
 *  A soft dark shadow keeps it readable on any background. */
function rasterizeShape(s: ShapeItem, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return ''
  const sw = Math.max(2, (s.strokePct / 100) * height)
  const fx = s.from.x * width
  const fy = s.from.y * height
  const tx = s.to.x * width
  const ty = s.to.y * height
  ctx.lineWidth = sw
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = Math.max(3, sw * 0.8)
  if (s.kind === 'rect') {
    const x = Math.min(fx, tx)
    const y = Math.min(fy, ty)
    const w = Math.abs(tx - fx)
    const h = Math.abs(ty - fy)
    if (s.filled) {
      ctx.save()
      ctx.globalAlpha = 0.3
      ctx.shadowBlur = 0
      ctx.fillRect(x, y, w, h)
      ctx.restore()
    }
    ctx.strokeRect(x, y, w, h)
  } else {
    // Shorten the shaft so it meets the base of the head, not the tip.
    const angle = Math.atan2(ty - fy, tx - fx)
    const headLen = Math.max(sw * 4, 14)
    const shaftX = tx - Math.cos(angle) * headLen * 0.8
    const shaftY = ty - Math.sin(angle) * headLen * 0.8
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(shaftX, shaftY)
    ctx.stroke()
    drawArrowHead(ctx, { x: fx, y: fy }, { x: tx, y: ty }, sw)
  }
  return canvas.toDataURL('image/png')
}

/** Rasterize a text to a full-frame transparent PNG at the video's native
 *  resolution — what ffmpeg overlays onto the frame. Same font stack as the
 *  preview divs so what you place is what gets burned in. */
function rasterizeText(t: TextItem, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return ''
  const px = (t.sizePct / 100) * height
  ctx.font = `700 ${px}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Dark halo for legibility on any background (mirrors the preview shadow).
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(2, px / 8)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.strokeText(t.text, t.x * width, t.y * height)
  ctx.fillStyle = t.color
  ctx.fillText(t.text, t.x * width, t.y * height)
  return canvas.toDataURL('image/png')
}

interface ZoomRegion {
  x: number
  y: number
  width: number
  height: number
  start: number
  end: number
  ramp: number
}

/** Zoom factor that makes the region fit the frame (min of the two axes so
 *  the whole region stays visible), clamped to a sane range. */
function targetZoomOf(r: { width: number; height: number }): number {
  const z = Math.min(1 / Math.max(0.02, r.width), 1 / Math.max(0.02, r.height))
  return Math.max(1.05, Math.min(4, z))
}

function smoothstep01(u: number): number {
  const c = Math.max(0, Math.min(1, u))
  return c * c * (3 - 2 * c)
}

/** Animated zoom factor at source time t — mirrors the ffmpeg zoompan curve
 *  so the preview matches the export: ramp 1→target, hold, target→1. */
function zoomFactorAt(r: ZoomRegion, t: number): number {
  const target = targetZoomOf(r)
  const half = (r.end - r.start) / 2
  const ramp = Math.max(0.05, Math.min(r.ramp, half - 0.01))
  if (t <= r.start || t >= r.end) return 1
  if (t < r.start + ramp) return 1 + (target - 1) * smoothstep01((t - r.start) / ramp)
  if (t > r.end - ramp) return 1 + (target - 1) * (1 - smoothstep01((t - (r.end - ramp)) / ramp))
  return target
}

const SPEEDS = [0.5, 1, 1.5, 2] as const
/** Pointer within this many px of a handle grabs it. */
const HANDLE_HIT = 22
/** Pointer must travel this many px before a press becomes a drag-select. */
const DRAG_THRESHOLD = 5

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const cs = Math.floor((t % 1) * 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

/** Sort + merge overlapping/adjacent ranges (display + gap math only). */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges]
    .filter((r) => r.end > r.start + 0.02)
    .sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last !== undefined && r.start <= last.end + 0.02) {
      last.end = Math.max(last.end, r.end)
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/** Source ranges NOT covered by any clip — the red "removed" zones. */
function gapRanges(clips: Range[], duration: number): Range[] {
  if (duration <= 0) return []
  const covered = mergeRanges(clips)
  const gaps: Range[] = []
  let cursor = 0
  for (const c of covered) {
    if (c.start > cursor + 0.05) gaps.push({ start: cursor, end: c.start })
    cursor = Math.max(cursor, c.end)
  }
  if (cursor < duration - 0.05) gaps.push({ start: cursor, end: duration })
  return gaps
}

/** Remove [r.start, r.end] from every clip, keeping order (a clip fully
 *  inside the range disappears; a clip containing it splits in two). */
function subtractRange(clips: Range[], r: Range): Range[] {
  const out: Range[] = []
  for (const c of clips) {
    const left = { start: c.start, end: Math.min(c.end, r.start) }
    const right = { start: Math.max(c.start, r.end), end: c.end }
    if (left.end > left.start + 0.05) out.push(left)
    if (right.end > right.start + 0.05) out.push(right)
  }
  return out
}

/** The pieces of `r` that exist in the clip list, in clip order. */
function intersectionPieces(clips: Range[], r: Range): Range[] {
  const out: Range[] = []
  for (const c of clips) {
    const s = Math.max(c.start, r.start)
    const e = Math.min(c.end, r.end)
    if (e > s + 0.05) out.push({ start: s, end: e })
  }
  return out
}

export function VideoEditor(): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rulerRef = useRef<HTMLDivElement | null>(null)

  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string>('')

  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  /** Global audio gain: 1 = 100 %. Applied to preview AND export. */
  const [volume, setVolume] = useState(1)
  /** Per-selection gain overrides (source time). Multiply with the global. */
  const [volumeZones, setVolumeZones] = useState<
    Array<{ start: number; end: number; gain: number }>
  >([])
  /** Gain the "volume de la sélection" control will stamp on the next zone. */
  const [zoneGain, setZoneGain] = useState(1)

  // On-video texts (burned in at export via PNG overlays).
  const [texts, setTexts] = useState<TextItem[]>([])
  const [selectedText, setSelectedText] = useState<number | null>(null)
  const textIdRef = useRef(0)
  // On-video shapes (rectangles / arrows), same overlay pipeline as texts.
  const [shapes, setShapes] = useState<ShapeItem[]>([])
  const [selectedShape, setSelectedShape] = useState<number | null>(null)
  const shapeIdRef = useRef(0)
  // Active shape-handle drag: which endpoint (or the whole body) is moving.
  const shapeDragRef = useRef<{
    id: number
    pointerId: number
    grab: 'from' | 'to' | 'body'
    // For body drags: pointer offset from the shape's `from` point (fractions).
    offX: number
    offY: number
  } | null>(null)

  // Crop rectangle (fractions of the frame), or null for no crop. Unlike
  // text/shapes it's a single GLOBAL region that changes the output size.
  const [crop, setCrop] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const cropDragRef = useRef<{
    pointerId: number
    grab: 'nw' | 'ne' | 'sw' | 'se' | 'body'
    offX: number
    offY: number
  } | null>(null)

  // Animated zoom into a region (Ken-Burns, for tutorials). One effect: the
  // region rect + its source-time window + ramp. `editingZoom` shows the
  // region editor (no transform) so the user places it; otherwise the preview
  // animates the CSS zoom during playback.
  const [zoomRegion, setZoomRegion] = useState<ZoomRegion | null>(null)
  const [editingZoom, setEditingZoom] = useState(false)
  const zoomDragRef = useRef<{
    pointerId: number
    grab: 'nw' | 'ne' | 'sw' | 'se' | 'body'
    offX: number
    offY: number
  } | null>(null)
  const zoomRef = useRef<ZoomRegion | null>(null)
  zoomRef.current = zoomRegion
  const editingZoomRef = useRef(false)
  editingZoomRef.current = editingZoom
  // Rendered rect of the video INSIDE the preview box (object-contain math),
  // so the text layer overlays the pixels exactly.
  const previewBoxRef = useRef<HTMLDivElement | null>(null)
  const [videoRect, setVideoRect] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const textDragRef = useRef<{ id: number; pointerId: number } | null>(null)

  const updateVideoRect = useCallback((): void => {
    const box = previewBoxRef.current
    const v = videoRef.current
    if (box === null || v === null || v.videoWidth === 0 || v.videoHeight === 0) {
      return
    }
    const bw = box.clientWidth
    const bh = box.clientHeight
    const scale = Math.min(bw / v.videoWidth, bh / v.videoHeight)
    const w = v.videoWidth * scale
    const h = v.videoHeight * scale
    setVideoRect({ x: (bw - w) / 2, y: (bh - h) / 2, w, h })
  }, [])

  useEffect(() => {
    const box = previewBoxRef.current
    if (box === null) return
    const obs = new ResizeObserver(() => updateVideoRect())
    obs.observe(box)
    return () => obs.disconnect()
  }, [updateVideoRect])

  // Ordered clip list (the montage) + selection + selected clip.
  const [clips, setClips] = useState<Range[]>([])
  const [selStart, setSelStart] = useState(0)
  const [selEnd, setSelEnd] = useState(0)
  const [selectedClip, setSelectedClip] = useState<number | null>(null)

  const [fadeOn, setFadeOn] = useState(true)
  const [fadeDur, setFadeDur] = useState(0.5)

  const [progress, setProgress] = useState(0)
  const [resultPath, setResultPath] = useState<string | null>(null)

  // Hover feedback on the ruler: time bubble + resize cursor near handles.
  const [hover, setHover] = useState<{ t: number; nearHandle: boolean } | null>(null)

  const dragRef = useRef<{
    kind: 'start' | 'end' | 'press' | 'select'
    anchorT: number
    startClientX: number
  } | null>(null)
  const probingRef = useRef(false)
  const historyRef = useRef<Range[][]>([])
  const clipsRef = useRef<Range[]>([])
  clipsRef.current = clips
  const durationRef = useRef(0)
  durationRef.current = duration
  /** Index (in `clips`) currently being played — the playlist cursor. */
  const playIdxRef = useRef(0)

  // ---- WebAudio mixer (real >100 % gain + live VU meter) ----
  // The plain <video>.volume caps at 100 %, which is why "augmenter le son"
  // was inaudible. Routing the element through a GainNode lifts that cap in
  // the PREVIEW too; the AnalyserNode drives the meter. Needs the media to be
  // CORS-approved (crossOrigin="anonymous" + ACAO header on po-media://),
  // otherwise createMediaElementSource outputs silence.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const meterFillRef = useRef<HTMLDivElement | null>(null)
  const faderRef = useRef<HTMLDivElement | null>(null)
  const faderDraggingRef = useRef(false)
  const lastVolRef = useRef(1)
  const volumeRef = useRef(1)
  volumeRef.current = volume
  const zonesRef = useRef<Array<{ start: number; end: number; gain: number }>>([])
  zonesRef.current = volumeZones

  /** Effective gain at a source time: global × every matching zone (zones
   *  multiply, mirroring ffmpeg's chained volume filters). */
  const gainAt = (t: number): number => {
    let g = volumeRef.current
    for (const z of zonesRef.current) {
      if (t >= z.start && t < z.end) g *= z.gain
    }
    return g
  }

  /** Build the audio graph once, on a user gesture (first play). */
  const ensureAudioGraph = (): void => {
    const v = videoRef.current
    if (v === null || audioCtxRef.current !== null) return
    try {
      const ctx = new AudioContext()
      const src = ctx.createMediaElementSource(v)
      const gain = ctx.createGain()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(gain)
      gain.connect(analyser)
      analyser.connect(ctx.destination)
      gain.gain.value = volumeRef.current
      v.volume = 1 // the gain node owns loudness from now on
      audioCtxRef.current = ctx
      gainRef.current = gain
      analyserRef.current = analyser
    } catch {
      /* graph failed — playback still works, volume falls back to <=100 % */
    }
  }

  // ---- Load the input file ----
  const load = useCallback(async () => {
    setPhase('loading')
    setError(null)
    const info = await window.api?.videoEditorGetInput()
    if (info === null || info === undefined) {
      setError('Aucune vidéo à éditer.')
      setPhase('error')
      return
    }
    probingRef.current = false
    historyRef.current = []
    playIdxRef.current = 0
    setDuration(0)
    setCurrentTime(0)
    setPlaying(false)
    setClips([])
    setSelectedClip(null)
    setVolumeZones([])
    setTexts([])
    setSelectedText(null)
    setShapes([])
    setSelectedShape(null)
    setCrop(null)
    setZoomRegion(null)
    setEditingZoom(false)
    setVideoUrl(`po-media://local/?p=${encodeURIComponent(info.path)}`)
    setInputPath(info.path)
    setOutputName(`${stripExt(info.name)} - montage`)
    setResultPath(null)
    setProgress(0)
    setPhase('ready')
  }, [])

  useEffect(() => {
    void load()
    const offLoad = window.api?.onVideoEditorLoad?.(() => void load())
    const offProg = window.api?.onVideoEditorProgress?.((p) => setProgress(p.ratio))
    return () => {
      offLoad?.()
      offProg?.()
    }
  }, [load])

  // ---- Duration discovery (MediaRecorder WebM reports Infinity) ----
  const initDuration = (d: number): void => {
    setDuration(d)
    setSelStart(0)
    setSelEnd(d)
    setClips([{ start: 0, end: d }])
    historyRef.current = []
    playIdxRef.current = 0
  }

  const onLoadedMetadata = (): void => {
    const v = videoRef.current
    if (v === null) return
    v.playbackRate = speed
    v.volume = gainRef.current !== null ? 1 : Math.min(1, volume)
    updateVideoRect()
    if (Number.isFinite(v.duration) && v.duration > 0) {
      initDuration(v.duration)
      return
    }
    probingRef.current = true
    setPhase('probing')
    try {
      v.currentTime = 1e9
    } catch {
      /* durationchange may still arrive on its own */
    }
  }

  const onDurationChange = (): void => {
    const v = videoRef.current
    if (v === null) return
    if (!Number.isFinite(v.duration) || v.duration <= 0) return
    if (probingRef.current) {
      probingRef.current = false
      v.currentTime = 0
      setPhase('ready')
    }
    initDuration(v.duration)
  }

  // ---- Playback: walk the clip list in order ----
  /** First clip containing t; else the next clip after t; else the last. */
  const idxFor = (t: number): number => {
    const list = clipsRef.current
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (c !== undefined && t >= c.start - 0.05 && t < c.end) return i
    }
    let best = -1
    let bestStart = Infinity
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (c !== undefined && c.start >= t && c.start < bestStart) {
        best = i
        bestStart = c.start
      }
    }
    return best >= 0 ? best : Math.max(0, list.length - 1)
  }

  const onTimeUpdate = (): void => {
    const v = videoRef.current
    if (v === null || probingRef.current) return
    const list = clipsRef.current
    const clip = list[playIdxRef.current]
    if (clip === undefined) {
      setCurrentTime(v.currentTime)
      return
    }
    // Far outside the current clip (mutation, external seek): resync.
    if (v.currentTime < clip.start - 0.3 || v.currentTime > clip.end + 0.3) {
      playIdxRef.current = idxFor(v.currentTime)
      setCurrentTime(v.currentTime)
      return
    }
    // Reached the end of this clip → jump to the next one (or stop).
    if (v.currentTime >= clip.end - 0.03) {
      const next = list[playIdxRef.current + 1]
      if (next !== undefined) {
        playIdxRef.current += 1
        if (Math.abs(v.currentTime - next.start) > 0.05) {
          v.currentTime = next.start
        }
        setCurrentTime(next.start)
        return
      }
      v.pause()
      setPlaying(false)
    }
    setCurrentTime(v.currentTime)
  }

  const togglePlay = useCallback((): void => {
    const v = videoRef.current
    if (v === null || probingRef.current) return
    if (v.paused) {
      // First play is a user gesture — the only moment browsers allow an
      // AudioContext to start. Resume also revives it after a suspend.
      ensureAudioGraph()
      void audioCtxRef.current?.resume().catch(() => {})
      // If parked in a removed zone or past the last clip, restart cleanly.
      const idx = idxFor(v.currentTime)
      const clip = clipsRef.current[idx]
      if (clip !== undefined && (v.currentTime < clip.start - 0.05 || v.currentTime >= clip.end - 0.05)) {
        playIdxRef.current = idx
        v.currentTime = clip.start
      }
      void v.play().then(() => setPlaying(true)).catch(() => {})
    } else {
      v.pause()
      setPlaying(false)
    }
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (v !== null) v.playbackRate = speed
  }, [speed])

  useEffect(() => {
    const v = videoRef.current
    const gain = gainRef.current
    if (gain !== null) {
      gain.gain.value = volume
      if (v !== null) v.volume = 1
    } else if (v !== null) {
      // Graph not built yet (nothing played) — element volume, capped at 1.
      v.volume = Math.min(1, volume)
    }
  }, [volume])

  // Live VU meter — reads the analyser at display rate and drives the fill
  // bar directly through a ref (no per-frame React re-render).
  useEffect(() => {
    const fill = meterFillRef.current
    if (!playing) {
      if (fill !== null) fill.style.height = '0%'
      return
    }
    let raf = 0
    let level = 0
    let buf: Uint8Array<ArrayBuffer> | null = null
    const tick = (): void => {
      // Zone-aware live gain: follow the playhead through the volume zones
      // so the preview sounds like the export will.
      const gain = gainRef.current
      const vid = videoRef.current
      if (gain !== null && vid !== null) {
        gain.gain.value = gainAt(vid.currentTime)
      }
      const analyser = analyserRef.current
      const el = meterFillRef.current
      if (analyser !== null && el !== null) {
        if (buf === null || buf.length !== analyser.fftSize) {
          buf = new Uint8Array(analyser.fftSize)
        }
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) {
          const dev = Math.abs((buf[i] ?? 128) - 128) / 128
          if (dev > peak) peak = dev
        }
        // Fast attack, slow decay — the classic meter feel.
        level = Math.max(peak, level * 0.92)
        el.style.height = `${Math.min(100, Math.round(level * 100))}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Tear the audio graph down with the window.
  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close().catch(() => {})
    }
  }, [])

  // Live zoom preview: while a zoom exists and we're NOT editing its region,
  // drive the video's CSS transform each frame from the same curve the export
  // uses (transform-origin at the region center = zoom toward it). Editing
  // mode leaves the video untransformed so the region can be placed on it.
  const hasZoom = zoomRegion !== null
  useEffect(() => {
    const clear = (): void => {
      const v = videoRef.current
      if (v !== null) {
        v.style.transform = ''
        v.style.transformOrigin = ''
      }
    }
    if (!hasZoom) {
      clear()
      return
    }
    let raf = 0
    const tick = (): void => {
      const v = videoRef.current
      const r = zoomRef.current
      if (v !== null && r !== null && !editingZoomRef.current) {
        const z = zoomFactorAt(r, v.currentTime)
        v.style.transformOrigin = `${(r.x + r.width / 2) * 100}% ${(r.y + r.height / 2) * 100}%`
        v.style.transform = `scale(${z.toFixed(4)})`
      } else if (v !== null) {
        v.style.transform = ''
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clear()
    }
  }, [hasZoom])

  // Clip list changed → keep the playlist cursor coherent. idxFor reads
  // refs (clipsRef), not state, so [clips] is the only dep that matters.
  useEffect(() => {
    playIdxRef.current = idxFor(videoRef.current?.currentTime ?? 0)
  }, [clips])

  const seekTo = useCallback((t: number, andPlay = false): void => {
    const v = videoRef.current
    if (v === null || probingRef.current) return
    let target = Math.max(0, Math.min(durationRef.current, t))
    const idx = idxFor(target)
    const clip = clipsRef.current[idx]
    // Seeking into a removed zone lands on the next kept clip instead.
    if (clip !== undefined && (target < clip.start || target >= clip.end)) {
      target = clip.start
    }
    playIdxRef.current = idx
    v.currentTime = target
    setCurrentTime(target)
    if (andPlay && v.paused) {
      void v.play().then(() => setPlaying(true)).catch(() => {})
    }
  }, [])

  // ---- Ruler interaction ----
  const timeFromClientX = (clientX: number): number => {
    const el = rulerRef.current
    if (el === null || duration <= 0) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const nearHandle = (clientX: number): 'start' | 'end' | null => {
    const el = rulerRef.current
    if (el === null || duration <= 0) return null
    const rect = el.getBoundingClientRect()
    const px = clientX - rect.left
    const dStart = Math.abs(px - (selStart / duration) * rect.width)
    const dEnd = Math.abs(px - (selEnd / duration) * rect.width)
    if (dStart <= HANDLE_HIT && dStart <= dEnd) return 'start'
    if (dEnd <= HANDLE_HIT) return 'end'
    return null
  }

  const onRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = rulerRef.current
    if (el === null || duration <= 0) return
    const handle = nearHandle(e.clientX)
    const t = timeFromClientX(e.clientX)
    dragRef.current = {
      kind: handle ?? 'press',
      anchorT: t,
      startClientX: e.clientX
    }
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported — move events still flow */
    }
    if (handle === 'start') setSelStart(Math.min(t, selEnd - 0.1))
    else if (handle === 'end') setSelEnd(Math.max(t, selStart + 0.1))
  }

  const onRulerPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const t = timeFromClientX(e.clientX)
    if (drag === null) {
      // Pure hover: time bubble + resize cursor near a handle.
      setHover({ t, nearHandle: nearHandle(e.clientX) !== null })
      return
    }
    if (drag.kind === 'press') {
      if (Math.abs(e.clientX - drag.startClientX) < DRAG_THRESHOLD) return
      // The press turned into a drag → start a zone selection at the anchor.
      drag.kind = 'select'
      setSelectedClip(null)
    }
    if (drag.kind === 'select') {
      setSelStart(Math.min(drag.anchorT, t))
      setSelEnd(Math.max(drag.anchorT, t))
    } else if (drag.kind === 'start') {
      setSelStart(Math.min(t, selEnd - 0.1))
    } else if (drag.kind === 'end') {
      setSelEnd(Math.max(t, selStart + 0.1))
    }
  }

  const onRulerPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    // A plain click (no drag, not a handle) = play from that point.
    if (drag !== null && drag.kind === 'press') {
      seekTo(timeFromClientX(e.clientX), true)
    }
  }

  const onRulerLeave = (): void => setHover(null)

  // ---- Clip operations (all undoable) ----
  const mutateClips = (next: Range[]): void => {
    historyRef.current.push(clipsRef.current)
    if (historyRef.current.length > 50) historyRef.current.shift()
    setClips(next)
    setSelectedClip(null)
  }

  const cutSelection = useCallback((): void => {
    if (selEnd <= selStart + 0.05) return
    mutateClips(subtractRange(clipsRef.current, { start: selStart, end: selEnd }))
  }, [selStart, selEnd])

  const duplicateSelection = useCallback((): void => {
    const sel = { start: selStart, end: selEnd }
    const pieces = intersectionPieces(clipsRef.current, sel)
    if (pieces.length === 0) return
    // Insert the copy right after the last clip the selection touches.
    let lastIdx = -1
    clipsRef.current.forEach((c, i) => {
      if (Math.max(c.start, sel.start) < Math.min(c.end, sel.end)) lastIdx = i
    })
    const next = [...clipsRef.current]
    next.splice(lastIdx + 1, 0, ...pieces)
    mutateClips(next)
  }, [selStart, selEnd])

  const deleteClip = (idx: number): void => {
    const next = clipsRef.current.filter((_, i) => i !== idx)
    mutateClips(next)
  }

  const undo = (): void => {
    const prev = historyRef.current.pop()
    if (prev !== undefined) {
      setClips(prev)
      setSelectedClip(null)
    }
  }

  const resetClips = (): void => {
    if (duration <= 0) return
    mutateClips([{ start: 0, end: duration }])
  }

  const markStartHere = useCallback((): void => {
    setSelStart(Math.min(currentTime, selEnd - 0.1))
  }, [currentTime, selEnd])

  const markEndHere = useCallback((): void => {
    setSelEnd(Math.max(currentTime, selStart + 0.1))
  }, [currentTime, selStart])

  // ---- Mixer fader (vertical, 0..200 %) ----
  const setVolumeFromClientY = (clientY: number): void => {
    const el = faderRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height))
    // 0..2 in 5 % steps so the fader lands on round values.
    setVolume(Math.round(ratio * 40) / 20)
  }

  const onFaderPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    faderDraggingRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported */
    }
    setVolumeFromClientY(e.clientY)
  }

  const onFaderPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (faderDraggingRef.current) setVolumeFromClientY(e.clientY)
  }

  const onFaderPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    faderDraggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const toggleMute = (): void => {
    if (volume > 0) {
      lastVolRef.current = volume
      setVolume(0)
    } else {
      setVolume(lastVolRef.current > 0 ? lastVolRef.current : 1)
    }
  }

  // ---- On-video texts ----
  /** Visibility window for a new annotation: the selection when it's a real
   *  sub-range, else 3 s from the playhead. */
  const newAnnotationWindow = (): { start: number; end: number } => {
    const selIsSubRange = selEnd > selStart + 0.05 && selEnd - selStart < duration - 0.05
    const start = selIsSubRange ? selStart : Math.min(currentTime, Math.max(0, duration - 0.5))
    const end = selIsSubRange ? selEnd : Math.min(duration, start + 3)
    return { start, end }
  }

  const addText = (): void => {
    if (duration <= 0) return
    const { start, end } = newAnnotationWindow()
    const id = ++textIdRef.current
    setTexts((prev) => [
      ...prev,
      { id, text: 'Ton texte', x: 0.5, y: 0.22, sizePct: 6, color: '#FFFFFF', start, end }
    ])
    setSelectedShape(null)
    setSelectedText(id)
    seekTo(start)
  }

  const patchText = (id: number, patch: Partial<TextItem>): void => {
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  const deleteText = (id: number): void => {
    setTexts((prev) => prev.filter((t) => t.id !== id))
    setSelectedText((cur) => (cur === id ? null : cur))
  }

  const onTextPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: number): void => {
    e.stopPropagation()
    setSelectedShape(null)
    setSelectedText(id)
    textDragRef.current = { id, pointerId: e.pointerId }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported */
    }
  }

  const onTextPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = textDragRef.current
    const rect = videoRect
    const box = previewBoxRef.current
    if (drag === null || rect === null || box === null || e.pointerId !== drag.pointerId) {
      return
    }
    const b = box.getBoundingClientRect()
    const x = (e.clientX - b.left - rect.x) / rect.w
    const y = (e.clientY - b.top - rect.y) / rect.h
    patchText(drag.id, {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y))
    })
  }

  const onTextPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    textDragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  // ---- On-video shapes ----
  /** Pointer client coords → frame fractions (clamped 0..1). */
  const fracFromClient = (clientX: number, clientY: number): Pt | null => {
    const rect = videoRect
    const box = previewBoxRef.current
    if (rect === null || box === null) return null
    const b = box.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (clientX - b.left - rect.x) / rect.w)),
      y: Math.max(0, Math.min(1, (clientY - b.top - rect.y) / rect.h))
    }
  }

  const addShape = (kind: 'rect' | 'arrow'): void => {
    if (duration <= 0) return
    const { start, end } = newAnnotationWindow()
    const id = ++shapeIdRef.current
    const shape: ShapeItem =
      kind === 'rect'
        ? { id, kind, from: { x: 0.34, y: 0.3 }, to: { x: 0.66, y: 0.7 }, color: '#FFC857', strokePct: 0.8, filled: false, start, end }
        : { id, kind, from: { x: 0.32, y: 0.68 }, to: { x: 0.6, y: 0.36 }, color: '#FF8B7B', strokePct: 1.1, filled: false, start, end }
    setShapes((prev) => [...prev, shape])
    setSelectedText(null)
    setSelectedShape(id)
    seekTo(start)
  }

  const patchShape = (id: number, patch: Partial<ShapeItem>): void => {
    setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const deleteShape = (id: number): void => {
    setShapes((prev) => prev.filter((s) => s.id !== id))
    setSelectedShape((cur) => (cur === id ? null : cur))
  }

  const onShapePointerDown = (
    e: React.PointerEvent<SVGElement>,
    id: number,
    grab: 'from' | 'to' | 'body'
  ): void => {
    e.stopPropagation()
    setSelectedText(null)
    setSelectedShape(id)
    const shape = shapes.find((s) => s.id === id)
    const p = fracFromClient(e.clientX, e.clientY)
    const offX = shape !== undefined && p !== null ? p.x - shape.from.x : 0
    const offY = shape !== undefined && p !== null ? p.y - shape.from.y : 0
    shapeDragRef.current = { id, pointerId: e.pointerId, grab, offX, offY }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported */
    }
  }

  const onShapePointerMove = (e: React.PointerEvent<SVGElement>): void => {
    const drag = shapeDragRef.current
    if (drag === null || e.pointerId !== drag.pointerId) return
    const p = fracFromClient(e.clientX, e.clientY)
    if (p === null) return
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== drag.id) return s
        if (drag.grab === 'from') return { ...s, from: p }
        if (drag.grab === 'to') return { ...s, to: p }
        // Body: translate both endpoints, keeping the grab offset.
        const nfx = p.x - drag.offX
        const nfy = p.y - drag.offY
        const dx = nfx - s.from.x
        const dy = nfy - s.from.y
        return {
          ...s,
          from: { x: nfx, y: nfy },
          to: { x: s.to.x + dx, y: s.to.y + dy }
        }
      })
    )
  }

  const onShapePointerUp = (e: React.PointerEvent<SVGElement>): void => {
    shapeDragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  // ---- Crop ----
  const toggleCrop = (): void => {
    if (crop === null) {
      // Start from a centered 80 % box.
      setCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
      setSelectedText(null)
      setSelectedShape(null)
      // Crop resizes the frame, zoom pans within it — keep them exclusive.
      setZoomRegion(null)
      setEditingZoom(false)
    } else {
      setCrop(null)
    }
  }

  const onCropPointerDown = (
    e: React.PointerEvent<SVGElement>,
    grab: 'nw' | 'ne' | 'sw' | 'se' | 'body'
  ): void => {
    e.stopPropagation()
    if (crop === null) return
    const p = fracFromClient(e.clientX, e.clientY)
    cropDragRef.current = {
      pointerId: e.pointerId,
      grab,
      offX: p !== null ? p.x - crop.x : 0,
      offY: p !== null ? p.y - crop.y : 0
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported */
    }
  }

  const onCropPointerMove = (e: React.PointerEvent<SVGElement>): void => {
    const drag = cropDragRef.current
    if (drag === null || e.pointerId !== drag.pointerId) return
    const p = fracFromClient(e.clientX, e.clientY)
    if (p === null) return
    const MIN = 0.05
    setCrop((prev) => {
      if (prev === null) return prev
      if (drag.grab === 'body') {
        const x = Math.max(0, Math.min(1 - prev.width, p.x - drag.offX))
        const y = Math.max(0, Math.min(1 - prev.height, p.y - drag.offY))
        return { ...prev, x, y }
      }
      // Corner: one x-edge + one y-edge move, the opposite corner is fixed.
      let left = prev.x
      let right = prev.x + prev.width
      let top = prev.y
      let bottom = prev.y + prev.height
      if (drag.grab === 'nw' || drag.grab === 'sw') left = p.x
      else right = p.x
      if (drag.grab === 'nw' || drag.grab === 'ne') top = p.y
      else bottom = p.y
      const nx = Math.min(left, right)
      const nw = Math.max(MIN, Math.abs(right - left))
      const ny = Math.min(top, bottom)
      const nh = Math.max(MIN, Math.abs(bottom - top))
      return { x: nx, y: ny, width: nw, height: nh }
    })
  }

  const onCropPointerUp = (e: React.PointerEvent<SVGElement>): void => {
    cropDragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  // ---- Zoom (animated) ----
  const addZoom = (): void => {
    if (duration <= 0) return
    if (zoomRegion !== null) {
      // Already there → just re-enter its region editor.
      setEditingZoom(true)
      return
    }
    const { start, end } = newAnnotationWindow()
    setZoomRegion({ x: 0.3, y: 0.3, width: 0.4, height: 0.4, start, end, ramp: 0.6 })
    setEditingZoom(true)
    setSelectedText(null)
    setSelectedShape(null)
    setCrop(null)
    seekTo(start)
  }

  const patchZoom = (patch: Partial<ZoomRegion>): void => {
    setZoomRegion((prev) => (prev === null ? prev : { ...prev, ...patch }))
  }

  const onZoomPointerDown = (
    e: React.PointerEvent<SVGElement>,
    grab: 'nw' | 'ne' | 'sw' | 'se' | 'body'
  ): void => {
    e.stopPropagation()
    if (zoomRegion === null) return
    const p = fracFromClient(e.clientX, e.clientY)
    zoomDragRef.current = {
      pointerId: e.pointerId,
      grab,
      offX: p !== null ? p.x - zoomRegion.x : 0,
      offY: p !== null ? p.y - zoomRegion.y : 0
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported */
    }
  }

  const onZoomPointerMove = (e: React.PointerEvent<SVGElement>): void => {
    const drag = zoomDragRef.current
    if (drag === null || e.pointerId !== drag.pointerId) return
    const p = fracFromClient(e.clientX, e.clientY)
    if (p === null) return
    const MIN = 0.05
    setZoomRegion((prev) => {
      if (prev === null) return prev
      if (drag.grab === 'body') {
        return {
          ...prev,
          x: Math.max(0, Math.min(1 - prev.width, p.x - drag.offX)),
          y: Math.max(0, Math.min(1 - prev.height, p.y - drag.offY))
        }
      }
      let left = prev.x
      let right = prev.x + prev.width
      let top = prev.y
      let bottom = prev.y + prev.height
      if (drag.grab === 'nw' || drag.grab === 'sw') left = p.x
      else right = p.x
      if (drag.grab === 'nw' || drag.grab === 'ne') top = p.y
      else bottom = p.y
      return {
        ...prev,
        x: Math.min(left, right),
        y: Math.min(top, bottom),
        width: Math.max(MIN, Math.abs(right - left)),
        height: Math.max(MIN, Math.abs(bottom - top))
      }
    })
  }

  const onZoomPointerUp = (e: React.PointerEvent<SVGElement>): void => {
    zoomDragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'i' || e.key === 'I') {
        markStartHere()
      } else if (e.key === 'o' || e.key === 'O') {
        markEndHere()
      } else if (e.key === 'c' || e.key === 'C') {
        cutSelection()
      } else if (e.key === 'd' || e.key === 'D') {
        duplicateSelection()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekTo(currentTime - (e.shiftKey ? 5 : 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekTo(currentTime + (e.shiftKey ? 5 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, markStartHere, markEndHere, cutSelection, duplicateSelection, seekTo, currentTime])

  // ---- Export ----
  const handleExport = useCallback(async () => {
    if (inputPath === null) return
    if (clips.length === 0) {
      setError('Tout est coupé — il ne reste rien à exporter.')
      setPhase('error')
      return
    }
    setPhase('exporting')
    setProgress(0)
    setError(null)
    // Untouched timeline → send no segments: main keeps the fast path (video
    // stream copied bit-for-bit for volume-only edits).
    const isWholeFile =
      clips.length === 1 &&
      clips[0] !== undefined &&
      clips[0].start < 0.05 &&
      clips[0].end > duration - 0.05
    // Burn-in texts + shapes: rasterized HERE at the video's native
    // resolution so the export matches the preview exactly. Shapes go first
    // so text stays on top (same as the preview z-order). Even dims so the
    // overlays align with the zoom's zoompan output (which is even too).
    const vwRaw = videoRef.current?.videoWidth ?? 0
    const vhRaw = videoRef.current?.videoHeight ?? 0
    const vw = vwRaw - (vwRaw % 2)
    const vh = vhRaw - (vhRaw % 2)
    const exportOverlays =
      vw > 0 && vh > 0
        ? [
            ...shapes.map((s) => ({
              dataUrl: rasterizeShape(s, vw, vh),
              start: s.start,
              end: s.end
            })),
            ...texts
              .filter((t) => t.text.trim().length > 0)
              .map((t) => ({ dataUrl: rasterizeText(t, vw, vh), start: t.start, end: t.end }))
          ].filter((o) => o.dataUrl.length > 0)
        : []
    // Resolve the zoom region into a center + fit-factor spec for ffmpeg.
    const zoomSpec =
      zoomRegion !== null && vw > 0 && vh > 0
        ? {
            cx: zoomRegion.x + zoomRegion.width / 2,
            cy: zoomRegion.y + zoomRegion.height / 2,
            zoom: targetZoomOf(zoomRegion),
            start: zoomRegion.start,
            end: zoomRegion.end,
            ramp: zoomRegion.ramp,
            outW: vw,
            outH: vh,
            fps: 30
          }
        : null
    const res = await window.api?.videoEditorExport({
      inputPath,
      segments:
        isWholeFile && exportOverlays.length === 0 && crop === null && zoomSpec === null
          ? []
          : clips,
      speed,
      crop,
      transition: fadeOn && clips.length > 1 ? { duration: fadeDur } : null,
      volume,
      volumeZones,
      texts: exportOverlays,
      zoom: zoomSpec,
      outputName: outputName.trim().length > 0 ? outputName.trim() : 'montage'
    })
    if (res === undefined) {
      setError('Export indisponible.')
      setPhase('error')
      return
    }
    if (res.ok) {
      setResultPath(res.path)
      setPhase('done')
    } else {
      setError(exportError(res.reason))
      setPhase('error')
    }
  }, [inputPath, clips, duration, speed, fadeOn, fadeDur, volume, volumeZones, texts, shapes, crop, zoomRegion, outputName])

  const pickAnother = useCallback(async () => {
    const picked = await window.api?.videoEditorPickFile()
    if (picked === null || picked === undefined) return
    void load()
  }, [load])

  // ---- Derived display values ----
  const pct = (t: number): number => (duration > 0 ? (t / duration) * 100 : 0)
  const gaps = gapRanges(clips, duration)
  const totalKept = clips.reduce((sum, c) => sum + (c.end - c.start), 0)
  const fadeCount = fadeOn ? Math.max(0, clips.length - 1) : 0
  const finalDuration = Math.max(0, totalKept - fadeCount * fadeDur)
  const timelineReady = duration > 0 && phase !== 'probing'
  // Output-time layout of the clips lane: sequential blocks.
  let cumul = 0
  const clipBlocks = clips.map((c, i) => {
    const w = totalKept > 0 ? ((c.end - c.start) / totalKept) * 100 : 0
    const block = { clip: c, idx: i, left: cumul, width: w }
    cumul += w
    return block
  })

  const rulerCursor = !timelineReady
    ? 'cursor-wait opacity-50'
    : hover?.nearHandle === true
      ? 'cursor-ew-resize'
      : 'cursor-pointer'

  return (
    <div className="flex h-screen w-screen flex-col bg-[#07212F] text-[#E7F3ED]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Scissors className="h-4 w-4 text-[#3BE6C0]" />
        <span className="text-sm font-semibold tracking-tight">Éditeur vidéo</span>
        <span
          className="text-[11px] text-[#5b8a7e]"
          title="Espace : lecture/pause · I : début de sélection · O : fin · C : couper · D : dupliquer · ←/→ : ±1 s (Maj : ±5 s)"
        >
          Espace lecture · I/O bornes · C couper · D dupliquer · ←/→ avancer
        </span>
        <button
          type="button"
          onClick={() => void pickAnother()}
          title="Choisir un autre fichier vidéo à éditer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-[#cfe9e1] transition hover:bg-white/[0.12]"
        >
          <Upload className="h-3.5 w-3.5" /> Ouvrir une autre vidéo
        </button>
      </div>

      {phase === 'loading' ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#9fd6c9]">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : phase === 'error' && videoUrl === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Video className="h-8 w-8 text-[#ff8b7b]" />
          <p className="text-sm text-[#ff8b7b]">{error}</p>
          <button
            type="button"
            onClick={() => void pickAnother()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#3BE6C016] px-4 py-2 text-[13px] font-semibold text-[#3BE6C0] ring-1 ring-[#3BE6C033]"
          >
            <Upload className="h-4 w-4" /> Choisir une vidéo
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
          {/* Preview */}
          <div
            ref={previewBoxRef}
            className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/60 ring-1 ring-white/10"
          >
            {videoUrl !== null && (
              <video
                ref={videoRef}
                src={videoUrl}
                crossOrigin="anonymous"
                onLoadedMetadata={onLoadedMetadata}
                onDurationChange={onDurationChange}
                onTimeUpdate={onTimeUpdate}
                onClick={togglePlay}
                onEnded={() => setPlaying(false)}
                title="Clic : lecture / pause"
                className="max-h-full max-w-full cursor-pointer object-contain"
              />
            )}
            {/* Shape layer — SVG over the exact video rect. Root is
                click-through (pointer-events none); only the shapes + handles
                catch the pointer, so empty areas still play/pause the video. */}
            {videoRect !== null && (
              <svg
                className="pointer-events-none absolute"
                style={{
                  left: videoRect.x,
                  top: videoRect.y,
                  width: videoRect.w,
                  height: videoRect.h,
                  zIndex: 4
                }}
              >
                {shapes.map((s) => {
                  const visible =
                    (currentTime >= s.start && currentTime < s.end) || selectedShape === s.id
                  if (!visible) return null
                  const w = videoRect.w
                  const h = videoRect.h
                  const fx = s.from.x * w
                  const fy = s.from.y * h
                  const tx = s.to.x * w
                  const ty = s.to.y * h
                  const sw = Math.max(2, (s.strokePct / 100) * h)
                  const sel = selectedShape === s.id
                  const down = (grab: 'from' | 'to' | 'body') => (
                    e: React.PointerEvent<SVGElement>
                  ) => onShapePointerDown(e, s.id, grab)
                  const move = onShapePointerMove
                  const up = onShapePointerUp
                  return (
                    <g key={`shape-${s.id}`}>
                      {s.kind === 'rect' ? (
                        <>
                          <rect
                            x={Math.min(fx, tx)}
                            y={Math.min(fy, ty)}
                            width={Math.abs(tx - fx)}
                            height={Math.abs(ty - fy)}
                            fill={s.filled ? s.color : 'transparent'}
                            fillOpacity={s.filled ? 0.3 : 1}
                            stroke={s.color}
                            strokeWidth={sw}
                            style={{ pointerEvents: 'all', cursor: 'move' }}
                            onPointerDown={down('body')}
                            onPointerMove={move}
                            onPointerUp={up}
                            onPointerCancel={up}
                          />
                        </>
                      ) : (
                        <>
                          {/* Fat invisible hit line for easy grabbing */}
                          <line
                            x1={fx}
                            y1={fy}
                            x2={tx}
                            y2={ty}
                            stroke="transparent"
                            strokeWidth={Math.max(sw, 18)}
                            style={{ pointerEvents: 'stroke', cursor: 'move' }}
                            onPointerDown={down('body')}
                            onPointerMove={move}
                            onPointerUp={up}
                            onPointerCancel={up}
                          />
                          <line
                            x1={fx}
                            y1={fy}
                            x2={tx - Math.cos(Math.atan2(ty - fy, tx - fx)) * Math.max(sw * 4, 14) * 0.8}
                            y2={ty - Math.sin(Math.atan2(ty - fy, tx - fx)) * Math.max(sw * 4, 14) * 0.8}
                            stroke={s.color}
                            strokeWidth={sw}
                            strokeLinecap="round"
                            style={{ pointerEvents: 'none' }}
                          />
                          <polygon
                            points={arrowHeadPoints(fx, fy, tx, ty, Math.max(sw * 4, 14))}
                            fill={s.color}
                            style={{ pointerEvents: 'none' }}
                          />
                        </>
                      )}
                      {sel && (
                        <>
                          <circle
                            cx={fx}
                            cy={fy}
                            r={7}
                            fill="#3BE6C0"
                            stroke="#04211c"
                            strokeWidth={2}
                            style={{ pointerEvents: 'all', cursor: 'grab' }}
                            onPointerDown={down('from')}
                            onPointerMove={move}
                            onPointerUp={up}
                            onPointerCancel={up}
                          />
                          <circle
                            cx={tx}
                            cy={ty}
                            r={7}
                            fill="#3BE6C0"
                            stroke="#04211c"
                            strokeWidth={2}
                            style={{ pointerEvents: 'all', cursor: 'grab' }}
                            onPointerDown={down('to')}
                            onPointerMove={move}
                            onPointerUp={up}
                            onPointerCancel={up}
                          />
                        </>
                      )}
                    </g>
                  )
                })}
              </svg>
            )}
            {/* Text layer — draggable elements over the exact video rect.
                Visible during their time window, or always when selected. */}
            {videoRect !== null &&
              texts.map((t) => {
                const visible =
                  (currentTime >= t.start && currentTime < t.end) || selectedText === t.id
                if (!visible) return null
                return (
                  <div
                    key={`txt-${t.id}`}
                    onPointerDown={(e) => onTextPointerDown(e, t.id)}
                    onPointerMove={onTextPointerMove}
                    onPointerUp={onTextPointerUp}
                    onPointerCancel={onTextPointerUp}
                    title="Glisser pour déplacer · clic pour sélectionner et modifier en bas"
                    className={`absolute cursor-move touch-none select-none whitespace-pre rounded px-1 ${
                      selectedText === t.id ? 'ring-2 ring-[#3BE6C0]' : ''
                    }`}
                    style={{
                      left: videoRect.x + t.x * videoRect.w,
                      top: videoRect.y + t.y * videoRect.h,
                      transform: 'translate(-50%, -50%)',
                      fontSize: (t.sizePct / 100) * videoRect.h,
                      fontWeight: 700,
                      fontFamily: 'Inter, system-ui, sans-serif',
                      color: t.color,
                      textShadow:
                        '0 0 4px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.85)',
                      zIndex: 5
                    }}
                  >
                    {t.text}
                  </div>
                )
              })}
            {/* Crop layer — dims outside the kept region, draggable box with
                corner handles. On top so its handles are always grabbable. */}
            {videoRect !== null && crop !== null && (() => {
              const w = videoRect.w
              const h = videoRect.h
              const cx = crop.x * w
              const cy = crop.y * h
              const cw = crop.width * w
              const ch = crop.height * h
              const dim = 'rgba(4, 12, 18, 0.6)'
              const corner = (
                key: string,
                px: number,
                py: number,
                grab: 'nw' | 'ne' | 'sw' | 'se',
                cursor: string
              ) => (
                <circle
                  key={key}
                  cx={px}
                  cy={py}
                  r={7}
                  fill="#3BE6C0"
                  stroke="#04211c"
                  strokeWidth={2}
                  style={{ pointerEvents: 'all', cursor }}
                  onPointerDown={(e) => onCropPointerDown(e, grab)}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={onCropPointerUp}
                  onPointerCancel={onCropPointerUp}
                />
              )
              return (
                <svg
                  className="pointer-events-none absolute"
                  style={{ left: videoRect.x, top: videoRect.y, width: w, height: h, zIndex: 6 }}
                >
                  {/* Dimmed margins (pointer-through) */}
                  <rect x={0} y={0} width={w} height={cy} fill={dim} />
                  <rect x={0} y={cy + ch} width={w} height={Math.max(0, h - cy - ch)} fill={dim} />
                  <rect x={0} y={cy} width={cx} height={ch} fill={dim} />
                  <rect x={cx + cw} y={cy} width={Math.max(0, w - cx - cw)} height={ch} fill={dim} />
                  {/* Body — move the whole crop */}
                  <rect
                    x={cx}
                    y={cy}
                    width={cw}
                    height={ch}
                    fill="transparent"
                    stroke="#3BE6C0"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    style={{ pointerEvents: 'all', cursor: 'move' }}
                    onPointerDown={(e) => onCropPointerDown(e, 'body')}
                    onPointerMove={onCropPointerMove}
                    onPointerUp={onCropPointerUp}
                    onPointerCancel={onCropPointerUp}
                  />
                  {corner('nw', cx, cy, 'nw', 'nwse-resize')}
                  {corner('ne', cx + cw, cy, 'ne', 'nesw-resize')}
                  {corner('sw', cx, cy + ch, 'sw', 'nesw-resize')}
                  {corner('se', cx + cw, cy + ch, 'se', 'nwse-resize')}
                </svg>
              )
            })()}
            {/* Zoom region editor — only while placing the zone (video not
                transformed then). Amber box + corner handles. */}
            {videoRect !== null && zoomRegion !== null && editingZoom && (() => {
              const w = videoRect.w
              const h = videoRect.h
              const cx = zoomRegion.x * w
              const cy = zoomRegion.y * h
              const cw = zoomRegion.width * w
              const ch = zoomRegion.height * h
              const dim = 'rgba(4, 12, 18, 0.45)'
              const corner = (
                key: string,
                px: number,
                py: number,
                grab: 'nw' | 'ne' | 'sw' | 'se',
                cursor: string
              ) => (
                <circle
                  key={key}
                  cx={px}
                  cy={py}
                  r={7}
                  fill="#FFC857"
                  stroke="#04211c"
                  strokeWidth={2}
                  style={{ pointerEvents: 'all', cursor }}
                  onPointerDown={(e) => onZoomPointerDown(e, grab)}
                  onPointerMove={onZoomPointerMove}
                  onPointerUp={onZoomPointerUp}
                  onPointerCancel={onZoomPointerUp}
                />
              )
              return (
                <svg
                  className="pointer-events-none absolute"
                  style={{ left: videoRect.x, top: videoRect.y, width: w, height: h, zIndex: 7 }}
                >
                  <rect x={0} y={0} width={w} height={cy} fill={dim} />
                  <rect x={0} y={cy + ch} width={w} height={Math.max(0, h - cy - ch)} fill={dim} />
                  <rect x={0} y={cy} width={cx} height={ch} fill={dim} />
                  <rect x={cx + cw} y={cy} width={Math.max(0, w - cx - cw)} height={ch} fill={dim} />
                  <rect
                    x={cx}
                    y={cy}
                    width={cw}
                    height={ch}
                    fill="transparent"
                    stroke="#FFC857"
                    strokeWidth={2}
                    style={{ pointerEvents: 'all', cursor: 'move' }}
                    onPointerDown={(e) => onZoomPointerDown(e, 'body')}
                    onPointerMove={onZoomPointerMove}
                    onPointerUp={onZoomPointerUp}
                    onPointerCancel={onZoomPointerUp}
                  />
                  {corner('znw', cx, cy, 'nw', 'nwse-resize')}
                  {corner('zne', cx + cw, cy, 'ne', 'nesw-resize')}
                  {corner('zsw', cx, cy + ch, 'sw', 'nesw-resize')}
                  {corner('zse', cx + cw, cy + ch, 'se', 'nwse-resize')}
                </svg>
              )
            })()}
            {phase === 'probing' && (
              <span className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 text-[12px] text-[#9fd6c9]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyse de la durée…
              </span>
            )}
          </div>

          {/* Transport + speed + volume + fondu */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!timelineReady}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3BE6C016] text-[#3BE6C0] ring-1 ring-[#3BE6C033] transition hover:bg-[#3BE6C026] disabled:opacity-40"
              title={playing ? 'Pause (Espace)' : 'Lecture (Espace)'}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="font-mono text-[12px] tabular-nums text-[#9fd6c9]">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            <div className="flex items-center gap-1" title="Vitesse de lecture du montage (appliquée à l'export)">
              <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[#7fbfb0]">
                Vitesse
              </span>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  title={`Lire et exporter à ${s}×`}
                  className={`rounded-md px-2 py-1 text-[12px] font-semibold transition ${
                    speed === s
                      ? 'bg-[#2BD9AC] text-[#04211c]'
                      : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <div
              className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-2.5 py-1.5 ring-1 ring-white/10"
              title="Mixeur audio : le fader règle le volume (0 à 200 %), appliqué à l'aperçu ET à l'export. Le vumètre montre le niveau pendant la lecture. Double-clic sur le fader : retour à 100 %. Le trait repère le 100 %."
            >
              <button
                type="button"
                onClick={toggleMute}
                title={volume <= 0 ? 'Rétablir le son' : 'Couper le son'}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#9fd6c9] transition hover:bg-white/[0.08]"
              >
                {volume <= 0 ? (
                  <VolumeX className="h-4 w-4 text-[#ff8b7b]" />
                ) : (
                  <Volume2 className="h-4 w-4 text-[#3BE6C0]" />
                )}
              </button>
              {/* VU meter — fill driven by the analyser at display rate */}
              <div className="relative h-14 w-2 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/10">
                <div
                  ref={meterFillRef}
                  className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#2BD9AC] via-[#FFC857] to-[#ff5a5a]"
                  style={{ height: '0%' }}
                />
              </div>
              {/* Vertical fader */}
              <div
                ref={faderRef}
                role="slider"
                aria-label="Volume du montage"
                aria-valuemin={0}
                aria-valuemax={200}
                aria-valuenow={Math.round(volume * 100)}
                onPointerDown={onFaderPointerDown}
                onPointerMove={onFaderPointerMove}
                onPointerUp={onFaderPointerUp}
                onPointerCancel={onFaderPointerUp}
                onDoubleClick={() => setVolume(1)}
                className="relative h-14 w-5 cursor-ns-resize touch-none"
              >
                <span className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-white/15" />
                {/* 100 % notch */}
                <span className="absolute left-0 right-0 top-1/2 h-px bg-white/30" />
                <span
                  className="absolute left-0 right-0 h-2.5 rounded-[3px] bg-[#3BE6C0] shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
                  style={{ bottom: `calc(${(volume / 2) * 100}% - 5px)` }}
                />
              </div>
              <div className="flex w-14 flex-col text-[10px] leading-tight text-[#9fd6c9]">
                <span className="font-mono font-semibold tabular-nums text-[#E7F3ED]">
                  {Math.round(volume * 100)}%
                </span>
                <span className="font-mono tabular-nums">
                  {volume <= 0
                    ? '−∞ dB'
                    : `${20 * Math.log10(volume) >= 0 ? '+' : ''}${(20 * Math.log10(volume)).toFixed(1)} dB`}
                </span>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFadeOn((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                  fadeOn
                    ? 'bg-[#2BD9AC] text-[#04211c]'
                    : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
                }`}
                title="Fondu enchaîné aux jonctions : chaque coupe se dissout dans la suite au lieu de sauter"
              >
                <Blend className="h-3.5 w-3.5" /> Fondu aux coupes
              </button>
              {fadeOn && (
                <label
                  className="flex items-center gap-2 text-[11px] text-[#9fd6c9]"
                  title="Durée du fondu à chaque jonction"
                >
                  <input
                    type="range"
                    min={0.2}
                    max={1.5}
                    step={0.1}
                    value={fadeDur}
                    onChange={(e) => setFadeDur(Number(e.target.value))}
                    className="w-24 accent-[#3BE6C0]"
                  />
                  <span className="font-mono tabular-nums">{fadeDur.toFixed(1)}s</span>
                </label>
              )}
            </div>
          </div>

          {/* LANE 1 — ruler (source time) */}
          <div className="select-none">
            <div
              ref={rulerRef}
              aria-label="Timeline source. Clic : lire depuis ce point. Glisser : sélectionner une zone. Poignées : ajuster la sélection."
              className={`relative h-12 w-full touch-none rounded-lg bg-white/[0.05] ring-1 ring-white/10 ${rulerCursor}`}
              onPointerDown={timelineReady ? onRulerPointerDown : undefined}
              onPointerMove={timelineReady ? onRulerPointerMove : undefined}
              onPointerUp={timelineReady ? onRulerPointerUp : undefined}
              onPointerCancel={timelineReady ? onRulerPointerUp : undefined}
              onPointerLeave={onRulerLeave}
            >
              {/* Current selection */}
              <div
                className="pointer-events-none absolute inset-y-0 bg-[#3BE6C022] ring-1 ring-[#3BE6C055]"
                style={{
                  left: `${pct(selStart)}%`,
                  width: `${Math.max(0, pct(selEnd) - pct(selStart))}%`
                }}
              />
              {/* Removed zones */}
              {gaps.map((g, i) => (
                <div
                  key={`gap-${g.start}-${i}`}
                  className="pointer-events-none absolute inset-y-0 flex items-center justify-center bg-[#ff5a5a44] ring-1 ring-[#ff8b7b88]"
                  style={{
                    left: `${pct(g.start)}%`,
                    width: `${Math.max(0, pct(g.end) - pct(g.start))}%`
                  }}
                >
                  <Scissors className="h-3 w-3 text-[#ffb1a4]" />
                </div>
              ))}
              {/* Volume zones — amber floor bands */}
              {volumeZones.map((z, i) => (
                <div
                  key={`vz-${z.start}-${i}`}
                  className="pointer-events-none absolute bottom-0 h-1/3 border-t border-[#FFC857aa] bg-[#FFC85733]"
                  style={{
                    left: `${pct(z.start)}%`,
                    width: `${Math.max(0, pct(z.end) - pct(z.start))}%`
                  }}
                  title={`Volume ${Math.round(z.gain * 100)} % sur cette zone`}
                />
              ))}
              {/* Playhead */}
              <div
                className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white"
                style={{ left: `${pct(currentTime)}%` }}
              />
              {/* Hover time bubble */}
              {hover !== null && dragRef.current === null && (
                <div
                  className="pointer-events-none absolute -top-7 z-20 -translate-x-1/2 rounded-md bg-[#04211c] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[#3BE6C0] ring-1 ring-[#3BE6C055]"
                  style={{ left: `${pct(hover.t)}%` }}
                >
                  {fmt(hover.t)}
                </div>
              )}
              {/* Selection handles (visuals; the ruler owns the pointer) */}
              <div
                className="pointer-events-none absolute inset-y-0 flex w-4 -translate-x-1/2 items-center justify-center rounded bg-[#3BE6C0] shadow-[0_0_0_1px_rgba(4,33,28,0.5)]"
                style={{ left: `${pct(selStart)}%` }}
              >
                <span className="h-5 w-0.5 bg-[#04211c]" />
              </div>
              <div
                className="pointer-events-none absolute inset-y-0 flex w-4 -translate-x-1/2 items-center justify-center rounded bg-[#3BE6C0] shadow-[0_0_0_1px_rgba(4,33,28,0.5)]"
                style={{ left: `${pct(selEnd)}%` }}
              >
                <span className="h-5 w-0.5 bg-[#04211c]" />
              </div>
            </div>

            {/* LANE 2 — montage (output order, duplicates visible) */}
            <div className="relative mt-1.5 h-9 w-full" aria-label="Montage résultant, dans l'ordre de lecture">
              {clipBlocks.map((b) => (
                <button
                  key={`clip-${b.idx}-${b.clip.start}`}
                  type="button"
                  onClick={() => {
                    setSelectedClip(b.idx)
                    setSelStart(b.clip.start)
                    setSelEnd(b.clip.end)
                    playIdxRef.current = b.idx
                    const v = videoRef.current
                    if (v !== null) {
                      v.currentTime = b.clip.start
                      setCurrentTime(b.clip.start)
                    }
                  }}
                  title={`Clip ${b.idx + 1} : ${fmt(b.clip.start)} → ${fmt(b.clip.end)} · Clic : sélectionner ce clip et s'y placer`}
                  className={`absolute inset-y-0 overflow-hidden rounded-md bg-gradient-to-b from-[#0F4C43] to-[#0A332D] text-left transition ${
                    selectedClip === b.idx
                      ? 'ring-2 ring-[#3BE6C0]'
                      : 'ring-1 ring-[#3BE6C044] hover:ring-[#3BE6C099]'
                  }`}
                  style={{ left: `${b.left}%`, width: `${Math.max(0.5, b.width)}%` }}
                >
                  <span className="px-1.5 text-[10px] font-semibold text-[#9fd6c9]">
                    {b.idx + 1}
                  </span>
                </button>
              ))}
              {/* Fade badges at output joints */}
              {fadeOn &&
                clipBlocks.slice(1).map((b) => (
                  <span
                    key={`fade-${b.idx}`}
                    className="pointer-events-none absolute top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#04211c] ring-1 ring-[#3BE6C0]"
                    style={{ left: `${b.left}%` }}
                    title="Fondu enchaîné à cette jonction"
                  >
                    <Blend className="h-3 w-3 text-[#3BE6C0]" />
                  </span>
                ))}
              {clips.length === 0 && duration > 0 && (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] text-[#ff8b7b]">
                  Tout est coupé
                </span>
              )}
            </div>

            {/* Selection + clip controls */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#9fd6c9]">
              <span className="font-mono tabular-nums" title="Zone sélectionnée sur la timeline source">
                Sélection {fmt(selStart)} → {fmt(selEnd)}
              </span>
              <button
                type="button"
                onClick={markStartHere}
                disabled={!timelineReady}
                className="rounded-md bg-white/[0.05] px-2 py-1 font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Placer le début de la sélection sur la tête de lecture (touche I)"
              >
                Début ici
              </button>
              <button
                type="button"
                onClick={markEndHere}
                disabled={!timelineReady}
                className="rounded-md bg-white/[0.05] px-2 py-1 font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Placer la fin de la sélection sur la tête de lecture (touche O)"
              >
                Fin ici
              </button>
              <button
                type="button"
                onClick={cutSelection}
                disabled={!timelineReady || selEnd <= selStart + 0.05}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#ff8b7b] to-[#f86a57] px-3 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
                title="Retirer la zone sélectionnée du montage — la lecture reprend juste après (touche C)"
              >
                <Scissors className="h-3.5 w-3.5" /> Retirer
              </button>
              <button
                type="button"
                onClick={duplicateSelection}
                disabled={!timelineReady || selEnd <= selStart + 0.05}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Insérer une copie de la zone sélectionnée juste après elle, pour la rejouer (touche D)"
              >
                <Copy className="h-3.5 w-3.5" /> Dupliquer
              </button>
              <button
                type="button"
                onClick={addText}
                disabled={!timelineReady}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Ajouter un texte sur la vidéo (affiché pendant la sélection, ou 3 s à partir de la tête de lecture). Glisse-le sur l'image pour le placer ; il sera incrusté à l'export."
              >
                <Type className="h-3.5 w-3.5" /> Texte
              </button>
              <button
                type="button"
                onClick={() => addShape('rect')}
                disabled={!timelineReady}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Encadrer une zone : un rectangle apparaît sur l'image, glisse-le / redimensionne-le par ses poignées. Incrusté à l'export sur la fenêtre de temps choisie."
              >
                <Square className="h-3.5 w-3.5" /> Cadre
              </button>
              <button
                type="button"
                onClick={() => addShape('arrow')}
                disabled={!timelineReady}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Pointer un élément : une flèche apparaît, déplace ses deux extrémités par les poignées. Incrustée à l'export."
              >
                <ArrowUpRight className="h-3.5 w-3.5" /> Flèche
              </button>
              <button
                type="button"
                onClick={toggleCrop}
                disabled={!timelineReady}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${
                  crop !== null
                    ? 'bg-[#2BD9AC] text-[#04211c]'
                    : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
                }`}
                title="Recadrer la vidéo : ne garder qu'une zone de l'image. Déplace le cadre / redimensionne-le par ses coins ; l'extérieur (assombri) sera retiré à l'export."
              >
                <Crop className="h-3.5 w-3.5" /> Recadrer
              </button>
              <button
                type="button"
                onClick={addZoom}
                disabled={!timelineReady}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${
                  zoomRegion !== null
                    ? 'bg-[#FFC857] text-[#04211c]'
                    : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
                }`}
                title="Zoom animé sur une zone (pour les tutos) : place le cadre ambre sur ce que tu veux agrandir, définis la fenêtre de temps. La caméra zoome en douceur puis revient."
              >
                <ZoomIn className="h-3.5 w-3.5" /> Zoom
              </button>
              <span
                className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-1"
                title="Volume appliqué uniquement à la zone sélectionnée (se cumule avec le fader global du mixeur). Règle le pourcentage puis OK. Zones marquées en ambre sur la timeline."
              >
                <Volume2 className="h-3.5 w-3.5 text-[#FFC857]" />
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={Math.round(zoneGain * 100)}
                  onChange={(e) => setZoneGain(Number(e.target.value) / 100)}
                  className="w-20 accent-[#FFC857]"
                />
                <span className="w-9 font-mono tabular-nums">{Math.round(zoneGain * 100)}%</span>
                <button
                  type="button"
                  onClick={() =>
                    setVolumeZones((prev) => [
                      ...prev,
                      { start: selStart, end: selEnd, gain: zoneGain }
                    ])
                  }
                  disabled={
                    !timelineReady || zoneGain === 1 || selEnd <= selStart + 0.05
                  }
                  className="rounded-md bg-[#FFC857] px-1.5 py-0.5 text-[10px] font-bold text-[#04211c] transition hover:brightness-110 disabled:opacity-40"
                  title="Appliquer ce volume à la sélection (100 % = aucun effet, choisis une autre valeur)"
                >
                  OK
                </button>
              </span>
              {selectedClip !== null && clips[selectedClip] !== undefined && (
                <button
                  type="button"
                  onClick={() => deleteClip(selectedClip)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#ff5a5a22] px-3 py-1.5 text-[12px] font-semibold text-[#ffb1a4] ring-1 ring-[#ff8b7b55] transition hover:bg-[#ff5a5a33]"
                  title="Supprimer uniquement ce clip du montage (les autres copies restent)"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer le clip {selectedClip + 1}
                </button>
              )}
              <button
                type="button"
                onClick={undo}
                disabled={historyRef.current.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Annuler la dernière opération (coupe, duplication, suppression)"
              >
                <Undo2 className="h-3.5 w-3.5" /> Annuler
              </button>
              <button
                type="button"
                onClick={resetClips}
                disabled={!timelineReady}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-40"
                title="Revenir à la vidéo entière (annule toutes les coupes et duplications)"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
              </button>
              <span className="ml-auto" title="Durée du montage final, fondus déduits">
                {clips.length} clip{clips.length > 1 ? 's' : ''} · Final {fmt(finalDuration)}
                {speed !== 1 && ` → ${fmt(finalDuration / speed)} à ${speed}×`}
              </span>
            </div>

            {/* Selected text — edit panel */}
            {selectedText !== null &&
              (() => {
                const t = texts.find((x) => x.id === selectedText)
                if (t === undefined) return null
                return (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px] text-[#9fd6c9] ring-1 ring-white/10">
                    <Type className="h-3.5 w-3.5 text-[#3BE6C0]" />
                    <input
                      type="text"
                      value={t.text}
                      onChange={(e) => patchText(t.id, { text: e.target.value })}
                      spellCheck={false}
                      placeholder="Texte affiché"
                      title="Contenu du texte"
                      className="w-44 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[12px] text-[#E7F3ED] outline-none focus:border-[#3BE6C066]"
                    />
                    <label className="flex items-center gap-1.5" title="Taille du texte (en % de la hauteur de l'image)">
                      Taille
                      <input
                        type="range"
                        min={3}
                        max={15}
                        step={0.5}
                        value={t.sizePct}
                        onChange={(e) => patchText(t.id, { sizePct: Number(e.target.value) })}
                        className="w-20 accent-[#3BE6C0]"
                      />
                    </label>
                    <span className="flex items-center gap-1" title="Couleur du texte">
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => patchText(t.id, { color: c })}
                          className={`h-4 w-4 rounded-full ring-2 transition ${
                            t.color === c ? 'ring-[#3BE6C0]' : 'ring-white/20'
                          }`}
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </span>
                    <span className="font-mono tabular-nums" title="Fenêtre d'affichage du texte (temps source)">
                      {fmt(t.start)} → {fmt(t.end)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (selEnd > selStart + 0.05) {
                          patchText(t.id, { start: selStart, end: selEnd })
                        }
                      }}
                      className="rounded-md bg-white/[0.05] px-2 py-1 font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1]"
                      title="Afficher ce texte pendant la sélection courante de la timeline"
                    >
                      Caler sur la sélection
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteText(t.id)}
                      className="rounded-md bg-[#ff5a5a22] px-2 py-1 font-semibold text-[#ffb1a4] ring-1 ring-[#ff8b7b55] transition hover:bg-[#ff5a5a33]"
                      title="Supprimer ce texte"
                    >
                      Supprimer
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedText(null)}
                      className="ml-auto rounded-md bg-white/[0.05] px-2 py-1 font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1]"
                      title="Fermer ce panneau (le texte reste)"
                    >
                      OK
                    </button>
                  </div>
                )
              })()}

            {/* Texts — chips (click = select + jump to its window) */}
            {texts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {texts.map((t) => (
                  <button
                    key={`txtc-${t.id}`}
                    type="button"
                    onClick={() => {
                      setSelectedText(t.id)
                      seekTo(t.start)
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono tabular-nums ring-1 transition ${
                      selectedText === t.id
                        ? 'bg-[#3BE6C022] text-[#3BE6C0] ring-[#3BE6C0]'
                        : 'bg-white/[0.05] text-[#cfe9e1] ring-white/15 hover:bg-white/[0.1]'
                    }`}
                    title={`Texte « ${t.text} » affiché de ${fmt(t.start)} à ${fmt(t.end)} — clic pour le modifier`}
                  >
                    <Type className="h-3 w-3" />
                    {t.text.length > 18 ? `${t.text.slice(0, 18)}…` : t.text}
                  </button>
                ))}
              </div>
            )}

            {/* Selected shape — edit panel */}
            {selectedShape !== null &&
              (() => {
                const s = shapes.find((x) => x.id === selectedShape)
                if (s === undefined) return null
                return (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px] text-[#9fd6c9] ring-1 ring-white/10">
                    {s.kind === 'rect' ? (
                      <Square className="h-3.5 w-3.5 text-[#FFC857]" />
                    ) : (
                      <ArrowUpRight className="h-3.5 w-3.5 text-[#FF8B7B]" />
                    )}
                    <span className="font-semibold text-[#cfe9e1]">
                      {s.kind === 'rect' ? 'Cadre' : 'Flèche'}
                    </span>
                    <label className="flex items-center gap-1.5" title="Épaisseur du trait (en % de la hauteur de l'image)">
                      Trait
                      <input
                        type="range"
                        min={0.3}
                        max={3}
                        step={0.1}
                        value={s.strokePct}
                        onChange={(e) => patchShape(s.id, { strokePct: Number(e.target.value) })}
                        className="w-20 accent-[#3BE6C0]"
                      />
                    </label>
                    {s.kind === 'rect' && (
                      <button
                        type="button"
                        onClick={() => patchShape(s.id, { filled: !s.filled })}
                        className={`rounded-md px-2 py-1 font-semibold transition ${
                          s.filled
                            ? 'bg-[#3BE6C0] text-[#04211c]'
                            : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
                        }`}
                        title="Remplir le cadre d'un voile translucide (utile pour masquer légèrement une zone)"
                      >
                        Remplir
                      </button>
                    )}
                    <span className="flex items-center gap-1" title="Couleur">
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => patchShape(s.id, { color: c })}
                          className={`h-4 w-4 rounded-full ring-2 transition ${
                            s.color === c ? 'ring-[#3BE6C0]' : 'ring-white/20'
                          }`}
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </span>
                    <span className="font-mono tabular-nums" title="Fenêtre d'affichage (temps source)">
                      {fmt(s.start)} → {fmt(s.end)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (selEnd > selStart + 0.05) patchShape(s.id, { start: selStart, end: selEnd })
                      }}
                      className="rounded-md bg-white/[0.05] px-2 py-1 font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1]"
                      title="Afficher cette forme pendant la sélection courante de la timeline"
                    >
                      Caler sur la sélection
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteShape(s.id)}
                      className="rounded-md bg-[#ff5a5a22] px-2 py-1 font-semibold text-[#ffb1a4] ring-1 ring-[#ff8b7b55] transition hover:bg-[#ff5a5a33]"
                      title="Supprimer cette forme"
                    >
                      Supprimer
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedShape(null)}
                      className="ml-auto rounded-md bg-white/[0.05] px-2 py-1 font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1]"
                      title="Fermer ce panneau (la forme reste)"
                    >
                      OK
                    </button>
                  </div>
                )
              })()}

            {/* Shapes — chips (click = select + jump to its window) */}
            {shapes.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {shapes.map((s) => (
                  <button
                    key={`shapec-${s.id}`}
                    type="button"
                    onClick={() => {
                      setSelectedText(null)
                      setSelectedShape(s.id)
                      seekTo(s.start)
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono tabular-nums ring-1 transition ${
                      selectedShape === s.id
                        ? 'bg-[#3BE6C022] text-[#3BE6C0] ring-[#3BE6C0]'
                        : 'bg-white/[0.05] text-[#cfe9e1] ring-white/15 hover:bg-white/[0.1]'
                    }`}
                    title={`${s.kind === 'rect' ? 'Cadre' : 'Flèche'} de ${fmt(s.start)} à ${fmt(s.end)} — clic pour la modifier`}
                  >
                    {s.kind === 'rect' ? (
                      <Square className="h-3 w-3" />
                    ) : (
                      <ArrowUpRight className="h-3 w-3" />
                    )}
                    {fmt(s.start)} → {fmt(s.end)}
                  </button>
                ))}
              </div>
            )}

            {/* Zoom — edit panel */}
            {zoomRegion !== null && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px] text-[#9fd6c9] ring-1 ring-white/10">
                <ZoomIn className="h-3.5 w-3.5 text-[#FFC857]" />
                <span className="font-semibold text-[#cfe9e1]">
                  Zoom ×{targetZoomOf(zoomRegion).toFixed(1)}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingZoom((v) => !v)}
                  className={`rounded-md px-2 py-1 font-semibold transition ${
                    editingZoom
                      ? 'bg-[#FFC857] text-[#04211c]'
                      : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
                  }`}
                  title={editingZoom ? 'Terminer le placement et voir l’animation' : 'Modifier la zone de zoom'}
                >
                  {editingZoom ? 'Aperçu' : 'Modifier la zone'}
                </button>
                <label className="flex items-center gap-1.5" title="Durée de la transition d'entrée/sortie du zoom">
                  Transition
                  <input
                    type="range"
                    min={0.1}
                    max={1.5}
                    step={0.1}
                    value={zoomRegion.ramp}
                    onChange={(e) => patchZoom({ ramp: Number(e.target.value) })}
                    className="w-20 accent-[#FFC857]"
                  />
                  <span className="font-mono tabular-nums">{zoomRegion.ramp.toFixed(1)}s</span>
                </label>
                <span className="font-mono tabular-nums" title="Fenêtre de temps du zoom (temps source)">
                  {fmt(zoomRegion.start)} → {fmt(zoomRegion.end)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (selEnd > selStart + 0.05) patchZoom({ start: selStart, end: selEnd })
                  }}
                  className="rounded-md bg-white/[0.05] px-2 py-1 font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1]"
                  title="Zoomer pendant la sélection courante de la timeline"
                >
                  Caler sur la sélection
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoomRegion(null)
                    setEditingZoom(false)
                  }}
                  className="rounded-md bg-[#ff5a5a22] px-2 py-1 font-semibold text-[#ffb1a4] ring-1 ring-[#ff8b7b55] transition hover:bg-[#ff5a5a33]"
                  title="Retirer le zoom"
                >
                  Supprimer
                </button>
              </div>
            )}

            {/* Crop — info chip */}
            {crop !== null && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#2BD9AC22] px-2 py-0.5 font-mono tabular-nums text-[#3BE6C0] ring-1 ring-[#3BE6C055]"
                  title="La vidéo exportée sera recadrée à cette zone (pourcentage de l'image d'origine)"
                >
                  <Crop className="h-3 w-3" />
                  Recadrage {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
                  <button
                    type="button"
                    onClick={() => setCrop(null)}
                    className="ml-0.5 rounded-full px-1 text-[#3BE6C0] transition hover:bg-[#3BE6C033] hover:text-white"
                    title="Retirer le recadrage (garder l'image entière)"
                  >
                    ✕
                  </button>
                </span>
              </div>
            )}

            {/* Volume zones — removable chips */}
            {volumeZones.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {volumeZones.map((z, i) => (
                  <span
                    key={`vzc-${z.start}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#FFC85722] px-2 py-0.5 font-mono tabular-nums text-[#FFC857] ring-1 ring-[#FFC85755]"
                    title="Zone de volume : la piste audio est jouée et exportée à ce pourcentage sur cette plage"
                  >
                    <Volume2 className="h-3 w-3" />
                    {fmt(z.start)} → {fmt(z.end)} · {Math.round(z.gain * 100)}%
                    <button
                      type="button"
                      onClick={() =>
                        setVolumeZones((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="ml-0.5 rounded-full px-1 text-[#FFC857] transition hover:bg-[#FFC85733] hover:text-white"
                      title="Retirer cette zone de volume"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Export bar */}
          <div className="flex items-center gap-3 border-t border-white/10 pt-3">
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              spellCheck={false}
              placeholder="Nom du montage"
              title="Nom du fichier exporté (dans Vidéos\PresentOtter\Edits)"
              className="flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-[#E7F3ED] outline-none transition focus:border-[#3BE6C066] focus:bg-white/[0.09]"
            />
            {phase === 'done' && resultPath !== null ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#3BE6C016] px-3 py-2 text-[12px] font-semibold text-[#3BE6C0]">
                  <Check className="h-3.5 w-3.5" /> Exporté
                </span>
                <button
                  type="button"
                  onClick={() => void window.api?.videoEditorReveal(resultPath)}
                  title="Afficher le fichier exporté dans l'explorateur"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-2 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.12]"
                >
                  <FolderOpen className="h-4 w-4" /> Ouvrir
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('ready')}
                  title="Continuer à éditer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-2 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.12]"
                >
                  <RotateCcw className="h-4 w-4" /> Nouveau
                </button>
              </>
            ) : phase === 'exporting' ? (
              <span className="inline-flex min-w-[160px] items-center gap-2 rounded-full bg-[#3BE6C016] px-4 py-2 text-[12px] font-semibold text-[#3BE6C0]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Export… {Math.round(progress * 100)}%
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={!timelineReady || finalDuration <= 0}
                title="Rendre le montage avec ffmpeg (coupes, duplications, fondus, vitesse, volume)"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#ff8b7b] to-[#f86a57] px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_14px_rgba(248,106,87,0.4)] transition hover:brightness-110 disabled:opacity-50"
              >
                <Scissors className="h-4 w-4" /> Exporter le montage
              </button>
            )}
          </div>
          {phase === 'error' && error !== null && (
            <p className="text-center text-[12px] text-[#ff8b7b]">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Turn an ffmpeg failure reason into something the user can act on. */
function exportError(reason: string): string {
  if (reason === 'ffmpeg-missing') {
    return 'ffmpeg est requis pour l\'export. Installe-le : winget install Gyan.FFmpeg'
  }
  if (reason === 'input-missing') return 'Fichier source introuvable.'
  return `Échec de l'export (${reason}).`
}
