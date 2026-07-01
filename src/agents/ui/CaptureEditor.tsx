import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Crop,
  Diamond,
  Edit3,
  EyeOff,
  FolderOpen,
  Highlighter,
  ListOrdered,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Save,
  SaveAll,
  Shapes,
  Smile,
  Square,
  Trash2,
  Type,
  Undo2
} from 'lucide-react'

/**
 * CaptureEditor — the dedicated pop-up that opens from the "capture copied"
 * notification (or auto, in dev).
 *
 * Annotations live in IMAGE pixel space (device resolution): the annotation
 * <canvas> internal size equals the still's natural size and is CSS-scaled
 * to fit. That keeps everything crisp and makes the export a trivial
 * composite (draw still, draw canvas, toPNG) with no coordinate math.
 *
 * Tools: select (move/edit/delete/resize/recolor an existing shape), pencil,
 * line, arrow, shapes (square/circle/diamond, each with independent
 * fill/outline toggles), highlighter, blur (a real gaussian blur — distinct
 * from the filled shape, which is a direct mask), text, numbered steps,
 * smileys, crop.
 *
 * Undo / redo walks a full history of shape-array snapshots (not just "last
 * shape added"), so every kind of edit — draw, move, delete, retype,
 * resize, recolor — is one Ctrl+Z step. Crop replaces the working image and
 * resets that history (the old coordinates would no longer map).
 */

type ToolId =
  | 'select'
  | 'pencil'
  | 'line'
  | 'arrow'
  | 'shape'
  | 'highlight'
  | 'blur'
  | 'text'
  | 'step'
  | 'emoji'
  | 'crop'

type ShapeKind = 'square' | 'circle' | 'diamond'

interface Pt {
  x: number
  y: number
}

type Shape =
  | { t: 'pencil' | 'highlight'; color: string; width: number; pts: Pt[] }
  | { t: 'line' | 'arrow'; color: string; width: number; a: Pt; b: Pt }
  // Square/circle/diamond share one shape record — `fill` and `stroke` are
  // independent toggles (both on: outlined solid; both off: invisible, the
  // user just hasn't picked one yet).
  | { t: 'shape'; kind: ShapeKind; color: string; width: number; a: Pt; b: Pt; fill: boolean; stroke: boolean }
  | { t: 'text'; color: string; size: number; pos: Pt; text: string }
  | { t: 'step'; color: string; size: number; num: number; pos: Pt; label: string }
  | { t: 'emoji'; pos: Pt; size: number; glyph: string }
  // Blurred redaction block. The pixel data is baked once (on drag-end)
  // from the base image so repaint() stays a cheap putImageData, no matter
  // how many times the canvas redraws.
  | { t: 'blur'; a: Pt; b: Pt; data: ImageData }
  // Transient drag preview for the blur tool — never pushed into `shapes`.
  | { t: 'blurDraft'; a: Pt; b: Pt }

interface EditorImage {
  dataUrl: string
  width: number
  height: number
}

const PALETTE = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#2BD9AC',
  '#3b82f6',
  '#a855f7',
  '#111827',
  '#ffffff'
]

const EMOJIS = ['👍', '👎', '✅', '❌', '⚠️', '❗', '❓', '💡', '🔥', '🎉', '😀', '❤️']

const SHAPE_KINDS: Array<{ id: ShapeKind; Icon: typeof Square; label: string }> = [
  { id: 'square', Icon: Square, label: 'Carré / rectangle' },
  { id: 'circle', Icon: Circle, label: 'Rond / ellipse' },
  { id: 'diamond', Icon: Diamond, label: 'Losange' }
]

const TOOLS: Array<{ id: ToolId; Icon: typeof Pencil; label: string }> = [
  { id: 'select', Icon: MousePointer2, label: 'Sélection — déplacer, modifier, redimensionner, supprimer' },
  { id: 'pencil', Icon: Pencil, label: 'Crayon' },
  { id: 'line', Icon: Minus, label: 'Ligne' },
  { id: 'arrow', Icon: ArrowUpRight, label: 'Flèche' },
  { id: 'shape', Icon: Shapes, label: 'Forme — carré, rond ou losange (choix ci-contre), avec ou sans remplissage/contour' },
  { id: 'highlight', Icon: Highlighter, label: 'Surligneur' },
  { id: 'blur', Icon: EyeOff, label: 'Flouter une zone' },
  { id: 'text', Icon: Type, label: 'Texte' },
  { id: 'step', Icon: ListOrdered, label: 'Étapes numérotées' },
  { id: 'emoji', Icon: Smile, label: 'Smiley' },
  { id: 'crop', Icon: Crop, label: 'Recadrer' }
]

function toBase64(dataUrl: string): string {
  return dataUrl.split(',')[1] ?? ''
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  width: number
): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const len = Math.max(12, width * 4)
  const spread = Math.PI / 7
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(
    b.x - len * Math.cos(angle - spread),
    b.y - len * Math.sin(angle - spread)
  )
  ctx.lineTo(
    b.x - len * Math.cos(angle + spread),
    b.y - len * Math.sin(angle + spread)
  )
  ctx.closePath()
  ctx.fill()
}

interface StepPillMetrics {
  lines: string[]
  fs: number
  lineHeight: number
  padX: number
  padY: number
  bx: number
  by: number
  bw: number
  bh: number
}

/** Layout for a step's caption pill — shared by drawShape (paint) and
 *  shapeBounds (hit-testing / selection box) so they can never drift apart. */
function measureStepPill(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { t: 'step' }>
): StepPillMetrics | null {
  if (s.label.trim().length === 0) return null
  const r = s.size
  const lines = s.label.split('\n')
  const fs = Math.round(r * 0.95)
  const lineHeight = fs * 1.25
  ctx.save()
  ctx.font = `600 ${fs}px Syne, system-ui, sans-serif`
  const padX = fs * 0.55
  const padY = fs * 0.4
  const tw = lines.reduce((max, l) => Math.max(max, ctx.measureText(l).width), 0)
  ctx.restore()
  const bx = s.pos.x + r + fs * 0.5
  const bh = lineHeight * lines.length + padY * 2
  const by = s.pos.y - bh / 2
  const bw = tw + padX * 2
  return { lines, fs, lineHeight, padX, padY, bx, by, bw, bh }
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.t === 'pencil' || s.t === 'highlight') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.t === 'highlight' ? s.width * 3 : s.width
    if (s.t === 'highlight') ctx.globalAlpha = 0.35
    ctx.beginPath()
    s.pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
  } else if (s.t === 'line' || s.t === 'arrow') {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.beginPath()
    ctx.moveTo(s.a.x, s.a.y)
    ctx.lineTo(s.b.x, s.b.y)
    ctx.stroke()
    if (s.t === 'arrow') drawArrowHead(ctx, s.a, s.b, s.width)
  } else if (s.t === 'shape') {
    const x = Math.min(s.a.x, s.b.x)
    const y = Math.min(s.a.y, s.b.y)
    const w = Math.abs(s.b.x - s.a.x)
    const h = Math.abs(s.b.y - s.a.y)
    ctx.beginPath()
    if (s.kind === 'square') {
      ctx.rect(x, y, w, h)
    } else if (s.kind === 'circle') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    } else {
      ctx.moveTo(x + w / 2, y)
      ctx.lineTo(x + w, y + h / 2)
      ctx.lineTo(x + w / 2, y + h)
      ctx.lineTo(x, y + h / 2)
      ctx.closePath()
    }
    if (s.fill) {
      ctx.fillStyle = s.color
      ctx.fill()
    }
    if (s.stroke) {
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width
      ctx.stroke()
    }
  } else if (s.t === 'text') {
    ctx.fillStyle = s.color
    ctx.font = `600 ${s.size}px Syne, system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(s.text, s.pos.x, s.pos.y)
  } else if (s.t === 'step') {
    const r = s.size
    // Numbered disc. JetBrains Mono (not Syne) for the digit: Syne's
    // stylised counters make 3/5/6/8 hard to tell apart at this size —
    // a monospace figure is unambiguous even at the smallest stroke width.
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(s.pos.x, s.pos.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${Math.round(r * 1.2)}px 'JetBrains Mono', ui-monospace, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(s.num), s.pos.x, s.pos.y + r * 0.04)
    // Caption pill to the right (matches the disc colour, white text).
    // The caption can span several lines (Enter in the inline editor).
    const pill = measureStepPill(ctx, s)
    if (pill !== null) {
      ctx.font = `600 ${pill.fs}px Syne, system-ui, sans-serif`
      ctx.textAlign = 'left'
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.roundRect(pill.bx, pill.by, pill.bw, pill.bh, Math.min(pill.bh * 0.24, 16))
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textBaseline = 'middle'
      pill.lines.forEach((line, i) => {
        ctx.fillText(line, pill.bx + pill.padX, pill.by + pill.padY + pill.lineHeight * i + pill.lineHeight / 2)
      })
    }
  } else if (s.t === 'emoji') {
    ctx.font = `${s.size}px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(s.glyph, s.pos.x, s.pos.y)
  } else if (s.t === 'blur') {
    const x = Math.round(Math.min(s.a.x, s.b.x))
    const y = Math.round(Math.min(s.a.y, s.b.y))
    ctx.putImageData(s.data, x, y)
  } else if (s.t === 'blurDraft') {
    const x = Math.min(s.a.x, s.b.x)
    const y = Math.min(s.a.y, s.b.y)
    const w = Math.abs(s.b.x - s.a.x)
    const h = Math.abs(s.b.y - s.a.y)
    ctx.setLineDash([10, 6])
    ctx.strokeStyle = '#2BD9AC'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = 'rgba(43,217,172,0.12)'
    ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
}

/**
 * Apply a real blur (not a flat mosaic fill) to a rect of the base image,
 * baked once into a standalone ImageData so repaint() stays a cheap
 * putImageData no matter how many times the canvas redraws. Distinct from
 * the "Bloc plein" filled shape, which is a direct opaque mask — this one
 * softens the underlying pixels so the result reads as blurred, not covered.
 *
 * The source rect sampled is padded well beyond the visible crop: canvas
 * `filter: blur()` has nothing to blend with past the edge of what it draws,
 * so without that margin the border of the patch fades toward transparent
 * instead of staying blurred.
 */
function blurRegion(
  base: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  blurPx = 16
): ImageData | null {
  const iw = Math.max(1, Math.round(w))
  const ih = Math.max(1, Math.round(h))
  const pad = Math.ceil(blurPx * 2)
  const canvas = document.createElement('canvas')
  canvas.width = iw + pad * 2
  canvas.height = ih + pad * 2
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.filter = `blur(${blurPx}px)`
  ctx.drawImage(base, x - pad, y - pad, iw + pad * 2, ih + pad * 2, 0, 0, iw + pad * 2, ih + pad * 2)
  return ctx.getImageData(pad, pad, iw, ih)
}

/** Axis-aligned bounding box of a shape in device (canvas) space — used for
 *  hit-testing (select tool) and to draw the selection outline. Padded a
 *  little on thin shapes (lines, strokes) so they're easy to click. */
function shapeBounds(ctx: CanvasRenderingContext2D, s: Shape): { x: number; y: number; w: number; h: number } {
  if (s.t === 'pencil' || s.t === 'highlight') {
    const xs = s.pts.map((p) => p.x)
    const ys = s.pts.map((p) => p.y)
    const pad = Math.max(s.width, 10)
    const minX = Math.min(...xs) - pad
    const maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad
    const maxY = Math.max(...ys) + pad
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  if (s.t === 'line' || s.t === 'arrow' || s.t === 'shape' || s.t === 'blur' || s.t === 'blurDraft') {
    const pad = 'width' in s ? Math.max(s.width, 10) : 4
    const minX = Math.min(s.a.x, s.b.x) - pad
    const maxX = Math.max(s.a.x, s.b.x) + pad
    const minY = Math.min(s.a.y, s.b.y) - pad
    const maxY = Math.max(s.a.y, s.b.y) + pad
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  if (s.t === 'text') {
    ctx.save()
    ctx.font = `600 ${s.size}px Syne, system-ui, sans-serif`
    const w = ctx.measureText(s.text.length > 0 ? s.text : ' ').width
    ctx.restore()
    return { x: s.pos.x - 4, y: s.pos.y - 4, w: w + 8, h: s.size * 1.35 + 8 }
  }
  if (s.t === 'emoji') {
    const half = s.size / 2
    return { x: s.pos.x - half, y: s.pos.y - half, w: s.size, h: s.size }
  }
  // s.t === 'step'. Kept as an explicit check (not an implicit trailing
  // block) — TS's narrowing across this many discriminants only resolves
  // cleanly when every branch, including the last, tests s.t directly.
  if (s.t === 'step') {
    const r = s.size
    const pill = measureStepPill(ctx, s)
    const minX = s.pos.x - r
    const maxX = pill !== null ? pill.bx + pill.bw : s.pos.x + r
    const minY = Math.min(s.pos.y - r, pill !== null ? pill.by : s.pos.y - r)
    const maxY = Math.max(s.pos.y + r, pill !== null ? pill.by + pill.bh : s.pos.y + r)
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  return { x: 0, y: 0, w: 0, h: 0 } // unreachable — every Shape variant is covered above
}

/** Topmost shape whose bounding box contains `p`, or null. */
function hitTestShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], p: Pt): number | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (s === undefined) continue
    const b = shapeBounds(ctx, s)
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i
  }
  return null
}

/** Move a shape by (dx, dy) in device space — used by the select tool's drag. */
function translateShape(s: Shape, dx: number, dy: number): Shape {
  if (s.t === 'pencil' || s.t === 'highlight') {
    return { ...s, pts: s.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
  }
  if (s.t === 'line' || s.t === 'arrow' || s.t === 'shape' || s.t === 'blur' || s.t === 'blurDraft') {
    return { ...s, a: { x: s.a.x + dx, y: s.a.y + dy }, b: { x: s.b.x + dx, y: s.b.y + dy } }
  }
  // s.t is 'text' | 'step' | 'emoji' here — all three carry `pos`. Explicit
  // checks (rather than an implicit trailing block) are what make TS narrow
  // this cleanly across a union this size.
  if (s.t === 'text' || s.t === 'step' || s.t === 'emoji') {
    return { ...s, pos: { x: s.pos.x + dx, y: s.pos.y + dy } }
  }
  return s // unreachable — every Shape variant is covered above
}

export function CaptureEditor(): React.ReactElement {
  const [img, setImg] = useState<EditorImage | null>(null)
  const [tool, setTool] = useState<ToolId>('pencil')
  const [color, setColor] = useState('#ef4444')
  const [width, setWidth] = useState(6)
  const [shapeKind, setShapeKind] = useState<ShapeKind>('square')
  const [shapeFill, setShapeFill] = useState(false)
  const [shapeStroke, setShapeStroke] = useState(true)
  const [emojiGlyph, setEmojiGlyph] = useState('👍')

  /** Undo/redo as a full history of shape-array snapshots plus a pointer,
   *  so every kind of edit (draw, move, delete, retype, resize, recolor)
   *  is a single Ctrl+Z step — not just "a new shape was added". */
  const [historyState, setHistoryState] = useState<{ list: Shape[][]; index: number }>({
    list: [[]],
    index: 0
  })
  const shapes = historyState.list[historyState.index] ?? []
  /** Live preview while dragging a shape or typing a step caption — kept
   *  out of history so intermediate frames/keystrokes don't each become an
   *  undo step. Committed once the gesture ends (pointerup / blur / Escape). */
  const [previewShapes, setPreviewShapes] = useState<Shape[] | null>(null)
  const effectiveShapes = previewShapes ?? shapes

  /** Snapshots taken before each crop ({ image, annotations }) so a crop
   *  can be undone — restoring the previous image and its shapes. */
  const [cropHistory, setCropHistory] = useState<
    Array<{ img: EditorImage; shapes: Shape[] }>
  >([])
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [textDraft, setTextDraft] = useState<{
    pos: Pt
    cssX: number
    cssY: number
    /** Set when re-opening an existing text shape for editing (select tool
     *  → Modifier) instead of creating a new one. */
    editIndex?: number
    initial?: string
  } | null>(null)
  const [captionDraft, setCaptionDraft] = useState<{
    shapeIndex: number
    cssX: number
    cssY: number
    value: string
  } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const selectedShape = selectedIndex !== null ? effectiveShapes[selectedIndex] ?? null : null

  const baseImgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const captionInputRef = useRef<HTMLTextAreaElement | null>(null)
  const draftRef = useRef<Shape | null>(null)
  const cropRef = useRef<{ a: Pt; b: Pt } | null>(null)
  const [cropBox, setCropBox] = useState<{ a: Pt; b: Pt } | null>(null)
  const drawingRef = useRef(false)
  const dragRef = useRef<{ index: number; orig: Shape; start: Pt } | null>(null)

  // Load image (initial + on reuse).
  useEffect(() => {
    void window.api?.editorGetImage().then((i) => {
      if (i !== null) setImg(i)
    })
    const off = window.api?.onEditorLoadImage((i) => {
      if (i !== null) {
        setImg(i)
        setHistoryState({ list: [[]], index: 0 })
        setPreviewShapes(null)
        setCropHistory([])
        setSavedPath(null)
        setSelectedIndex(null)
      }
    })
    return off
  }, [])

  // Switching tools drops the current selection so a stale outline / mini
  // toolbar doesn't linger over a tool that no longer supports it.
  useEffect(() => {
    if (tool !== 'select') setSelectedIndex(null)
  }, [tool])

  // Focus the inline text / caption inputs AFTER the pointerdown that
  // created them is fully processed. Doing it via rAF (instead of autoFocus)
  // avoids the browser's default pointerdown focus handling blurring — and
  // thus closing (onBlur) — the field before the user can type.
  useEffect(() => {
    if (textDraft === null) return
    const id = requestAnimationFrame(() => textInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [textDraft])
  useEffect(() => {
    if (captionDraft === null) return
    const id = requestAnimationFrame(() => captionInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [captionDraft?.shapeIndex])

  const deviceFromEvent = useCallback((e: React.PointerEvent): Pt => {
    const c = canvasRef.current
    if (c === null) return { x: 0, y: 0 }
    const r = c.getBoundingClientRect()
    const sx = c.width / r.width
    const sy = c.height / r.height
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }, [])

  /** Inverse of deviceFromEvent — used to position the floating "Modifier /
   *  Supprimer" toolbar and to re-open the inline editor at the right spot. */
  const cssFromDevice = useCallback((p: Pt): Pt => {
    const c = canvasRef.current
    if (c === null || c.width === 0 || c.height === 0) return { x: 0, y: 0 }
    const r = c.getBoundingClientRect()
    return { x: (p.x / c.width) * r.width, y: (p.y / c.height) * r.height }
  }, [])

  // Repaint the annotation canvas whenever shapes / draft / crop change.
  const repaint = useCallback(() => {
    const c = canvasRef.current
    if (c === null) return
    const ctx = c.getContext('2d')
    if (ctx === null) return
    ctx.clearRect(0, 0, c.width, c.height)
    for (const s of effectiveShapes) drawShape(ctx, s)
    if (draftRef.current !== null) drawShape(ctx, draftRef.current)
    // Crop preview — dim outside the box.
    const box = cropBox
    if (box !== null) {
      const x = Math.min(box.a.x, box.b.x)
      const y = Math.min(box.a.y, box.b.y)
      const w = Math.abs(box.b.x - box.a.x)
      const h = Math.abs(box.b.y - box.a.y)
      ctx.save()
      ctx.fillStyle = 'rgba(6,20,17,0.5)'
      ctx.fillRect(0, 0, c.width, y)
      ctx.fillRect(0, y + h, c.width, c.height - y - h)
      ctx.fillRect(0, y, x, h)
      ctx.fillRect(x + w, y, c.width - x - w, h)
      ctx.strokeStyle = '#2BD9AC'
      ctx.lineWidth = Math.max(2, c.width / 600)
      ctx.strokeRect(x, y, w, h)
      ctx.restore()
    }
  }, [effectiveShapes, cropBox])

  useEffect(() => {
    repaint()
  }, [repaint])

  // Size the canvas to the still's natural (device) resolution on load.
  const onImgLoad = () => {
    const el = baseImgRef.current
    const c = canvasRef.current
    if (el === null || c === null) return
    c.width = el.naturalWidth
    c.height = el.naturalHeight
    repaint()
  }

  /** Replace the committed shape array with `next`, truncating any redo
   *  branch — the single entry point for every undo-able edit. */
  const commitShapes = (next: Shape[]): void => {
    setHistoryState(({ list, index }) => ({
      list: [...list.slice(0, index + 1), next],
      index: index + 1
    }))
  }
  const pushShape = (s: Shape): void => {
    commitShapes([...shapes, s])
  }
  /** Reassign step numbers sequentially after a deletion so 1, 2, 4 doesn't
   *  linger once step 3 is removed. */
  const renumberSteps = (list: Shape[]): Shape[] => {
    let n = 0
    return list.map((s) => (s.t === 'step' ? { ...s, num: ++n } : s))
  }

  const deleteSelected = (): void => {
    if (selectedIndex === null) return
    commitShapes(renumberSteps(shapes.filter((_, i) => i !== selectedIndex)))
    setSelectedIndex(null)
  }

  /** Re-open the inline editor for the selected text/step, prefilled with
   *  its current content — the fix for "I clicked the wrong spot / made a
   *  typo" without having to delete and redraw from scratch. */
  const editSelected = (): void => {
    if (selectedIndex === null || selectedShape === null) return
    if (selectedShape.t === 'text') {
      const css = cssFromDevice(selectedShape.pos)
      setTextDraft({
        pos: selectedShape.pos,
        cssX: css.x,
        cssY: css.y,
        editIndex: selectedIndex,
        initial: selectedShape.text
      })
    } else if (selectedShape.t === 'step') {
      const css = cssFromDevice(selectedShape.pos)
      setCaptionDraft({
        shapeIndex: selectedIndex,
        cssX: css.x + 18,
        cssY: css.y - 10,
        value: selectedShape.label
      })
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || img === null) return
    const p = deviceFromEvent(e)
    if (tool === 'select') {
      e.preventDefault()
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx == null) return
      const idx = hitTestShapes(ctx, shapes, p)
      setSelectedIndex(idx)
      if (idx !== null) {
        const s = shapes[idx]
        if (s !== undefined) {
          dragRef.current = { index: idx, orig: s, start: p }
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          drawingRef.current = true
        }
      }
      return
    }
    if (tool === 'text') {
      e.preventDefault()
      const r = canvasRef.current?.getBoundingClientRect()
      setTextDraft({
        pos: p,
        cssX: e.clientX - (r?.left ?? 0),
        cssY: e.clientY - (r?.top ?? 0)
      })
      return
    }
    if (tool === 'step') {
      e.preventDefault()
      // Click drops the next numbered disc; a caption field opens next to it.
      const num = shapes.filter((s) => s.t === 'step').length + 1
      const r = Math.max(20, width * 3)
      const index = shapes.length
      pushShape({ t: 'step', color, size: r, num, pos: p, label: '' })
      const box = canvasRef.current?.getBoundingClientRect()
      setCaptionDraft({
        shapeIndex: index,
        cssX: e.clientX - (box?.left ?? 0) + 18,
        cssY: e.clientY - (box?.top ?? 0) - 10,
        value: ''
      })
      return
    }
    if (tool === 'emoji') {
      e.preventDefault()
      const size = Math.max(24, width * 4)
      pushShape({ t: 'emoji', pos: p, size, glyph: emojiGlyph })
      return
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    drawingRef.current = true
    if (tool === 'crop') {
      cropRef.current = { a: p, b: p }
      setCropBox({ a: p, b: p })
      return
    }
    if (tool === 'pencil' || tool === 'highlight') {
      draftRef.current = { t: tool, color, width, pts: [p] }
    } else if (tool === 'shape') {
      draftRef.current = { t: 'shape', kind: shapeKind, color, width, a: p, b: p, fill: shapeFill, stroke: shapeStroke }
    } else if (tool === 'blur') {
      draftRef.current = { t: 'blurDraft', a: p, b: p }
    } else {
      draftRef.current = { t: tool, color, width, a: p, b: p } as Shape
    }
    repaint()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const p = deviceFromEvent(e)
    if (tool === 'select') {
      const drag = dragRef.current
      if (drag === null) return
      const dx = p.x - drag.start.x
      const dy = p.y - drag.start.y
      setPreviewShapes(shapes.map((s, i) => (i === drag.index ? translateShape(drag.orig, dx, dy) : s)))
      return
    }
    if (tool === 'crop' && cropRef.current !== null) {
      cropRef.current = { a: cropRef.current.a, b: p }
      setCropBox({ a: cropRef.current.a, b: p })
      return
    }
    const d = draftRef.current
    if (d === null) return
    if (d.t === 'pencil' || d.t === 'highlight') {
      d.pts.push(p)
    } else if ('a' in d) {
      d.b = p
    }
    repaint()
  }

  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (tool === 'select') {
      const drag = dragRef.current
      dragRef.current = null
      if (drag !== null && previewShapes !== null) commitShapes(previewShapes)
      setPreviewShapes(null)
      return
    }
    if (tool === 'crop') {
      applyCrop()
      return
    }
    const d = draftRef.current
    draftRef.current = null
    if (d === null) return
    // Drop zero-size shapes.
    if (d.t === 'pencil' || d.t === 'highlight') {
      if (d.pts.length > 1) pushShape(d)
    } else if (d.t === 'blurDraft') {
      const x = Math.min(d.a.x, d.b.x)
      const y = Math.min(d.a.y, d.b.y)
      const w = Math.abs(d.b.x - d.a.x)
      const h = Math.abs(d.b.y - d.a.y)
      const base = baseImgRef.current
      if (w > 3 && h > 3 && base !== null) {
        const data = blurRegion(base, x, y, w, h)
        if (data !== null) {
          pushShape({ t: 'blur', a: { x, y }, b: { x: x + w, y: y + h }, data })
        }
      }
    } else if ('a' in d) {
      const dist = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)
      if (dist > 3) pushShape(d)
    }
    repaint()
  }

  const commitText = (text: string) => {
    if (textDraft !== null) {
      if (textDraft.editIndex !== undefined) {
        const idx = textDraft.editIndex
        // Blanking an existing text out removes it — a quick way to
        // delete without switching to the select tool's trash button.
        commitShapes(
          text.trim().length === 0
            ? shapes.filter((_, i) => i !== idx)
            : shapes.map((s, i) => (i === idx && s.t === 'text' ? { ...s, text } : s))
        )
        setSelectedIndex(null)
      } else if (text.trim().length > 0) {
        pushShape({ t: 'text', color, size: Math.max(16, width * 5), pos: textDraft.pos, text })
      }
    }
    setTextDraft(null)
  }

  const applyCrop = () => {
    const box = cropRef.current
    const base = baseImgRef.current
    cropRef.current = null
    setCropBox(null)
    if (box === null || base === null) return
    const x = Math.round(Math.min(box.a.x, box.b.x))
    const y = Math.round(Math.min(box.a.y, box.b.y))
    const w = Math.round(Math.abs(box.b.x - box.a.x))
    const h = Math.round(Math.abs(box.b.y - box.a.y))
    if (w < 5 || h < 5) return
    // Flatten current annotations into the crop so they survive.
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')
    if (ctx === null) return
    ctx.drawImage(base, x, y, w, h, 0, 0, w, h)
    const c = canvasRef.current
    if (c !== null) ctx.drawImage(c, x, y, w, h, 0, 0, w, h)
    const dataUrl = out.toDataURL('image/png')
    // Snapshot the pre-crop state so the crop can be undone.
    if (img !== null) {
      setCropHistory((h) => [...h, { img, shapes }])
    }
    setHistoryState({ list: [[]], index: 0 })
    setSelectedIndex(null)
    setImg({ dataUrl, width: w, height: h })
  }

  const undo = () => {
    // Undo annotations first (most recent actions), then crops.
    if (historyState.index > 0) {
      setHistoryState((h) => ({ list: h.list, index: h.index - 1 }))
      setSelectedIndex(null)
      return
    }
    if (cropHistory.length > 0) {
      const snap = cropHistory[cropHistory.length - 1]
      if (snap === undefined) return
      setCropHistory((h) => h.slice(0, -1))
      setImg(snap.img)
      setHistoryState({ list: [snap.shapes], index: 0 })
      setSelectedIndex(null)
    }
  }
  const redo = () => {
    setHistoryState((h) => (h.index < h.list.length - 1 ? { list: h.list, index: h.index + 1 } : h))
  }

  /** Composite still + annotations into a single PNG (base64, no prefix). */
  const exportPng = (): string | null => {
    const base = baseImgRef.current
    const c = canvasRef.current
    if (base === null || c === null) return null
    const out = document.createElement('canvas')
    out.width = base.naturalWidth
    out.height = base.naturalHeight
    const ctx = out.getContext('2d')
    if (ctx === null) return null
    ctx.drawImage(base, 0, 0)
    ctx.drawImage(c, 0, 0)
    return toBase64(out.toDataURL('image/png'))
  }

  const copy = async () => {
    const b64 = exportPng()
    if (b64 === null) return
    await window.api?.editorCopyImage(b64)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  const save = async () => {
    const b64 = exportPng()
    if (b64 === null) return
    const p = (await window.api?.editorSaveImage(b64)) ?? null
    if (p !== null) setSavedPath(p)
  }
  const saveAs = async () => {
    const b64 = exportPng()
    if (b64 === null) return
    const p = (await window.api?.editorSaveImageAs(b64)) ?? null
    if (p !== null) setSavedPath(p)
  }

  // Keyboard: Ctrl+Z / Ctrl+Y / Ctrl+C / Ctrl+S / Suppr.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textDraft !== null || captionDraft !== null) return
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void copy()
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select' && selectedIndex !== null) {
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [textDraft, captionDraft, historyState, cropHistory, tool, selectedIndex])

  /** Live-update the step caption being typed (new or re-opened via
   *  Modifier), via the preview layer so each keystroke isn't its own
   *  undo step — only the final text is committed, on close. */
  const updateCaption = (v: string): void => {
    setCaptionDraft((d) => (d !== null ? { ...d, value: v } : d))
    if (captionDraft === null) return
    const idx = captionDraft.shapeIndex
    setPreviewShapes(shapes.map((s, i) => (i === idx && s.t === 'step' ? { ...s, label: v } : s)))
  }
  const closeCaptionDraft = (): void => {
    if (previewShapes !== null) {
      commitShapes(previewShapes)
      setPreviewShapes(null)
    }
    setCaptionDraft(null)
    setSelectedIndex(null)
  }

  /** Palette / free-color picks also recolor the selected shape live, so
   *  "come back and fix it" covers color, not just position and text. */
  const onPickColor = (hex: string): void => {
    setColor(hex)
    if (selectedIndex !== null) {
      commitShapes(shapes.map((s, i) => (i === selectedIndex && 'color' in s ? { ...s, color: hex } : s)))
    }
  }

  const reveal = () => {
    if (savedPath !== null) void window.api?.editorReveal(savedPath)
  }

  // When a text, step or emoji is selected, the width slider repurposes
  // into a "size" control for that shape (font size / disc radius / glyph
  // size) instead of the pending brush stroke width.
  const resizable =
    selectedShape !== null && (selectedShape.t === 'text' || selectedShape.t === 'step' || selectedShape.t === 'emoji')
  const sliderLabel = resizable ? 'Taille' : 'Épaisseur'
  const sliderMin = resizable ? 10 : 2
  const sliderMax = !resizable ? 40 : selectedShape?.t === 'text' ? 220 : selectedShape?.t === 'emoji' ? 200 : 140
  const sliderValue = resizable && selectedShape !== null ? selectedShape.size : width
  const onSliderInput = (v: number): void => {
    if (resizable && selectedIndex !== null) {
      setPreviewShapes(
        shapes.map((s, i) =>
          i === selectedIndex && (s.t === 'text' || s.t === 'step' || s.t === 'emoji') ? { ...s, size: v } : s
        )
      )
    } else {
      setWidth(v)
    }
  }
  const onSliderCommit = (): void => {
    if (resizable && previewShapes !== null) {
      commitShapes(previewShapes)
      setPreviewShapes(null)
    }
  }

  // The "Forme" mini-controls (kind + fill + outline) show whenever the
  // shape tool is active, or an existing shape is selected — letting the
  // user come back and flip fill/outline on a shape already drawn, the
  // same way color picks already re-apply to a selection.
  const showShapeControls = tool === 'shape' || (selectedShape !== null && selectedShape.t === 'shape')
  const activeShapeKind = selectedShape !== null && selectedShape.t === 'shape' ? selectedShape.kind : shapeKind
  const activeShapeFill = selectedShape !== null && selectedShape.t === 'shape' ? selectedShape.fill : shapeFill
  const activeShapeStroke = selectedShape !== null && selectedShape.t === 'shape' ? selectedShape.stroke : shapeStroke
  const onPickShapeKind = (kind: ShapeKind): void => {
    if (selectedIndex !== null && selectedShape?.t === 'shape') {
      commitShapes(shapes.map((s, i) => (i === selectedIndex && s.t === 'shape' ? { ...s, kind } : s)))
    } else {
      setShapeKind(kind)
    }
  }
  const onToggleFill = (): void => {
    if (selectedIndex !== null && selectedShape?.t === 'shape') {
      commitShapes(shapes.map((s, i) => (i === selectedIndex && s.t === 'shape' ? { ...s, fill: !s.fill } : s)))
    } else {
      setShapeFill((f) => !f)
    }
  }
  const onToggleStroke = (): void => {
    if (selectedIndex !== null && selectedShape?.t === 'shape') {
      commitShapes(shapes.map((s, i) => (i === selectedIndex && s.t === 'shape' ? { ...s, stroke: !s.stroke } : s)))
    } else {
      setShapeStroke((f) => !f)
    }
  }

  // Selection outline + floating "Modifier / Supprimer" toolbar, in CSS
  // coordinates over the canvas.
  const selectionOverlay = (() => {
    if (selectedShape === null) return null
    const c = canvasRef.current
    if (c === null || c.width === 0) return null
    const ctx = c.getContext('2d')
    if (ctx === null) return null
    const b = shapeBounds(ctx, selectedShape)
    const r = c.getBoundingClientRect()
    const sx = r.width / c.width
    const sy = r.height / c.height
    return {
      x: b.x * sx,
      y: b.y * sy,
      w: b.w * sx,
      h: b.h * sy,
      canEdit: selectedShape.t === 'text' || selectedShape.t === 'step'
    }
  })()

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0A1F1B] text-[#E7F3ED]">
      {/* Top action bar */}
      <header className="flex items-center justify-between gap-3 border-b border-[#3BE6C022] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="text-base">🦦</span>
          <span className="font-semibold tracking-tight">Éditeur de capture</span>
          {img !== null && (
            <span className="ml-1 rounded-full bg-[#3BE6C015] px-2.5 py-0.5 font-mono text-[11px] text-[#3BE6C0]">
              {img.width} × {img.height}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <EditorButton onClick={copy} primary>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Copié' : 'Copier'}</span>
          </EditorButton>
          <EditorButton onClick={save}>
            <Save className="h-4 w-4" />
            <span>Enregistrer</span>
          </EditorButton>
          <EditorButton onClick={saveAs}>
            <SaveAll className="h-4 w-4" />
            <span>Sous…</span>
          </EditorButton>
        </div>
      </header>

      {/* Tool bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#3BE6C014] px-4 py-2">
        <div className="flex items-center gap-1">
          {TOOLS.map(({ id, Icon, label }) => (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => setTool(id)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                tool === id
                  ? 'bg-[#2BD9AC] text-[#06231D]'
                  : 'bg-[#3BE6C012] text-[#E7F3ED] hover:bg-[#3BE6C024]'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
            </button>
          ))}
        </div>

        {showShapeControls && (
          <>
            <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />
            <div className="flex items-center gap-1">
              {SHAPE_KINDS.map(({ id, Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => onPickShapeKind(id)}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                    activeShapeKind === id
                      ? 'bg-[#2BD9AC] text-[#06231D]'
                      : 'bg-[#3BE6C012] text-[#E7F3ED] hover:bg-[#3BE6C024]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Remplir la forme"
                onClick={onToggleFill}
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                  activeShapeFill
                    ? 'bg-[#2BD9AC] text-[#06231D]'
                    : 'bg-[#3BE6C012] text-[#E7F3ED] hover:bg-[#3BE6C024]'
                }`}
              >
                Remplir
              </button>
              <button
                type="button"
                title="Afficher le contour"
                onClick={onToggleStroke}
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                  activeShapeStroke
                    ? 'bg-[#2BD9AC] text-[#06231D]'
                    : 'bg-[#3BE6C012] text-[#E7F3ED] hover:bg-[#3BE6C024]'
                }`}
              >
                Contour
              </button>
            </div>
          </>
        )}

        {tool === 'emoji' && (
          <>
            <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />
            <div className="flex flex-wrap items-center gap-1">
              {EMOJIS.map((glyph) => (
                <button
                  key={glyph}
                  type="button"
                  onClick={() => setEmojiGlyph(glyph)}
                  className={`flex h-7 w-7 items-center justify-center rounded-md text-base transition ${
                    emojiGlyph === glyph ? 'bg-[#2BD9AC33] ring-1 ring-[#2BD9AC]' : 'hover:bg-white/10'
                  }`}
                >
                  {glyph}
                </button>
              ))}
            </div>
          </>
        )}

        <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />

        {/* Color palette */}
        <div className="flex items-center gap-1.5">
          {PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              onClick={() => onPickColor(hex)}
              className={`h-5 w-5 rounded-full transition ${
                color.toLowerCase() === hex.toLowerCase()
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0A1F1B]'
                  : 'ring-1 ring-white/25 hover:scale-110'
              }`}
              style={{ backgroundColor: hex }}
            />
          ))}
          <label className="ml-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-white/10" title="Couleur libre">
            <span className="h-3.5 w-3.5 rounded-full ring-1 ring-white/40" style={{ backgroundColor: color }} />
            <input type="color" value={color} onChange={(e) => onPickColor(e.target.value)} className="sr-only" />
          </label>
        </div>

        <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />

        {/* Stroke width — becomes "Taille" (font size / disc radius / glyph
            size) when a text, step or emoji is selected. */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#3BE6C0]">{sliderLabel}</span>
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            value={sliderValue}
            onChange={(e) => onSliderInput(Number(e.target.value))}
            onPointerUp={onSliderCommit}
            className="w-28 accent-[#2BD9AC]"
          />
          <span className="w-6 text-right font-mono text-[11px] text-[#E7F3ED]/70">{sliderValue}</span>
        </div>

        <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />

        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={historyState.index === 0 && cropHistory.length === 0} title="Annuler (Ctrl+Z) — annule aussi le recadrage" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3BE6C012] text-[#E7F3ED] transition hover:bg-[#3BE6C024] disabled:opacity-35">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={historyState.index === historyState.list.length - 1} title="Rétablir (Ctrl+Y)" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3BE6C012] text-[#E7F3ED] transition hover:bg-[#3BE6C024] disabled:opacity-35">
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <main className="relative flex flex-1 items-center justify-center overflow-auto p-6">
        {img === null ? (
          <p className="text-sm text-[#E7F3ED]/60">Chargement de la capture…</p>
        ) : (
          <div className="relative inline-block max-h-full max-w-full">
            <img
              ref={baseImgRef}
              src={img.dataUrl}
              alt="Capture"
              onLoad={onImgLoad}
              draggable={false}
              className="block max-h-[calc(100vh-160px)] max-w-full rounded-md shadow-[0_20px_60px_rgba(0,0,0,0.55)] ring-1 ring-[#3BE6C022]"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute inset-0 h-full w-full"
              style={{ cursor: tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair' }}
            />
            {textDraft !== null && (
              <input
                ref={textInputRef}
                type="text"
                defaultValue={textDraft.initial ?? ''}
                onBlur={(e) => commitText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value)
                  else if (e.key === 'Escape') setTextDraft(null)
                }}
                className="absolute z-10 rounded border border-[#2BD9AC] bg-black/70 px-1 py-0.5 text-sm outline-none"
                style={{ left: textDraft.cssX, top: textDraft.cssY, color }}
                placeholder="Texte…"
              />
            )}
            {captionDraft !== null && (
              <textarea
                ref={captionInputRef}
                rows={1}
                value={captionDraft.value}
                onChange={(e) => {
                  updateCaption(e.target.value)
                  // Auto-grow with the content instead of scrolling inside
                  // a fixed box, so a multi-line caption stays readable
                  // while it's being typed.
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                onBlur={closeCaptionDraft}
                onKeyDown={(e) => {
                  // Enter inserts a newline (default textarea behaviour) so
                  // captions can wrap onto a second line. Only Escape
                  // commits and closes the field.
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    closeCaptionDraft()
                  }
                }}
                className="absolute z-10 min-w-[160px] resize-none overflow-hidden rounded border border-[#2BD9AC] bg-black/70 px-1.5 py-1 text-sm leading-snug text-white outline-none"
                style={{ left: captionDraft.cssX, top: captionDraft.cssY }}
                placeholder="Légende (optionnel)… Entrée = nouvelle ligne, Échap = valider"
              />
            )}
            {selectionOverlay !== null && (
              <>
                <div
                  className="pointer-events-none absolute rounded-md ring-2 ring-[#2BD9AC]"
                  style={{
                    left: selectionOverlay.x,
                    top: selectionOverlay.y,
                    width: selectionOverlay.w,
                    height: selectionOverlay.h
                  }}
                />
                <div
                  className="absolute z-20 flex items-center gap-1 rounded-full bg-[#0A1F1B] px-1.5 py-1 shadow-[0_6px_20px_rgba(0,0,0,0.45)] ring-1 ring-[#3BE6C033]"
                  style={{ left: selectionOverlay.x, top: Math.max(0, selectionOverlay.y - 38) }}
                >
                  {selectionOverlay.canEdit && (
                    <button
                      type="button"
                      onClick={editSelected}
                      title="Modifier le contenu"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[#E7F3ED] transition hover:bg-[#3BE6C024]"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={deleteSelected}
                    title="Supprimer (Suppr)"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[#E7F3ED] transition hover:bg-red-500/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Saved toast */}
      {savedPath !== null && (
        <footer className="flex items-center justify-between gap-3 border-t border-[#3BE6C022] bg-[#3BE6C00d] px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-[#3BE6C0]">
            <Check className="h-4 w-4" />
            Enregistré : <span className="font-mono text-[12px] text-[#E7F3ED]/80">{savedPath}</span>
          </span>
          <button type="button" onClick={reveal} className="inline-flex items-center gap-1.5 rounded-full bg-[#3BE6C01a] px-3 py-1 text-[12px] font-semibold text-[#3BE6C0] transition hover:bg-[#3BE6C033]">
            <FolderOpen className="h-3.5 w-3.5" />
            Afficher dans le dossier
          </button>
        </footer>
      )}
    </div>
  )
}

interface EditorButtonProps {
  onClick: () => void
  children: React.ReactNode
  primary?: boolean
}

function EditorButton({ onClick, children, primary = false }: EditorButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
        primary
          ? 'bg-gradient-to-br from-[#2BD9AC] to-[#0FA587] text-[#06231D] shadow-[0_4px_16px_rgba(43,217,172,0.35)] hover:from-[#3BE6C0] hover:to-[#0FA587]'
          : 'bg-[#3BE6C014] text-[#E7F3ED] ring-1 ring-[#3BE6C022] hover:bg-[#3BE6C024]'
      }`}
    >
      {children}
    </button>
  )
}
