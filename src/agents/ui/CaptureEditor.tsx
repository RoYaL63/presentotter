import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Crop,
  FolderOpen,
  Highlighter,
  Minus,
  Pencil,
  Redo2,
  Save,
  SaveAll,
  Square,
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
 * Tools: pencil, line, arrow, rectangle, ellipse, highlighter, text, crop.
 * Undo / redo on the shape list. Crop replaces the working image and resets
 * the shapes (their coordinates would no longer map).
 */

type ToolId =
  | 'pencil'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'highlight'
  | 'text'
  | 'crop'

interface Pt {
  x: number
  y: number
}

type Shape =
  | { t: 'pencil' | 'highlight'; color: string; width: number; pts: Pt[] }
  | { t: 'line' | 'arrow'; color: string; width: number; a: Pt; b: Pt }
  | { t: 'rect' | 'ellipse'; color: string; width: number; a: Pt; b: Pt }
  | { t: 'text'; color: string; size: number; pos: Pt; text: string }

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

const TOOLS: Array<{ id: ToolId; Icon: typeof Pencil; label: string }> = [
  { id: 'pencil', Icon: Pencil, label: 'Crayon' },
  { id: 'line', Icon: Minus, label: 'Ligne' },
  { id: 'arrow', Icon: ArrowUpRight, label: 'Flèche' },
  { id: 'rect', Icon: Square, label: 'Rectangle' },
  { id: 'ellipse', Icon: Circle, label: 'Ellipse' },
  { id: 'highlight', Icon: Highlighter, label: 'Surligneur' },
  { id: 'text', Icon: Type, label: 'Texte' },
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
  } else if (s.t === 'rect') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.strokeRect(
      Math.min(s.a.x, s.b.x),
      Math.min(s.a.y, s.b.y),
      Math.abs(s.b.x - s.a.x),
      Math.abs(s.b.y - s.a.y)
    )
  } else if (s.t === 'ellipse') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    const cx = (s.a.x + s.b.x) / 2
    const cy = (s.a.y + s.b.y) / 2
    ctx.beginPath()
    ctx.ellipse(
      cx,
      cy,
      Math.abs(s.b.x - s.a.x) / 2,
      Math.abs(s.b.y - s.a.y) / 2,
      0,
      0,
      Math.PI * 2
    )
    ctx.stroke()
  } else if (s.t === 'text') {
    ctx.fillStyle = s.color
    ctx.font = `600 ${s.size}px Syne, system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(s.text, s.pos.x, s.pos.y)
  }
  ctx.restore()
}

export function CaptureEditor(): React.ReactElement {
  const [img, setImg] = useState<EditorImage | null>(null)
  const [tool, setTool] = useState<ToolId>('pencil')
  const [color, setColor] = useState('#ef4444')
  const [width, setWidth] = useState(6)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [redoStack, setRedoStack] = useState<Shape[]>([])
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [textDraft, setTextDraft] = useState<{ pos: Pt; cssX: number; cssY: number } | null>(null)

  const baseImgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const draftRef = useRef<Shape | null>(null)
  const cropRef = useRef<{ a: Pt; b: Pt } | null>(null)
  const [cropBox, setCropBox] = useState<{ a: Pt; b: Pt } | null>(null)
  const drawingRef = useRef(false)

  // Load image (initial + on reuse).
  useEffect(() => {
    void window.api?.editorGetImage().then((i) => {
      if (i !== null) setImg(i)
    })
    const off = window.api?.onEditorLoadImage((i) => {
      if (i !== null) {
        setImg(i)
        setShapes([])
        setRedoStack([])
        setSavedPath(null)
      }
    })
    return off
  }, [])

  const deviceFromEvent = useCallback((e: React.PointerEvent): Pt => {
    const c = canvasRef.current
    if (c === null) return { x: 0, y: 0 }
    const r = c.getBoundingClientRect()
    const sx = c.width / r.width
    const sy = c.height / r.height
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }, [])

  // Repaint the annotation canvas whenever shapes / draft / crop change.
  const repaint = useCallback(() => {
    const c = canvasRef.current
    if (c === null) return
    const ctx = c.getContext('2d')
    if (ctx === null) return
    ctx.clearRect(0, 0, c.width, c.height)
    for (const s of shapes) drawShape(ctx, s)
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
  }, [shapes, cropBox])

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

  const pushShape = (s: Shape) => {
    setShapes((prev) => [...prev, s])
    setRedoStack([])
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || img === null) return
    const p = deviceFromEvent(e)
    if (tool === 'text') {
      const r = canvasRef.current?.getBoundingClientRect()
      setTextDraft({
        pos: p,
        cssX: e.clientX - (r?.left ?? 0),
        cssY: e.clientY - (r?.top ?? 0)
      })
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
    } else {
      draftRef.current = { t: tool, color, width, a: p, b: p } as Shape
    }
    repaint()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const p = deviceFromEvent(e)
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
    } else if ('a' in d) {
      const dist = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)
      if (dist > 3) pushShape(d)
    }
    repaint()
  }

  const commitText = (text: string) => {
    if (textDraft !== null && text.trim().length > 0) {
      pushShape({
        t: 'text',
        color,
        size: Math.max(16, width * 5),
        pos: textDraft.pos,
        text
      })
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
    setShapes([])
    setRedoStack([])
    setImg({ dataUrl, width: w, height: h })
  }

  const undo = () => {
    if (shapes.length === 0) return
    const last = shapes[shapes.length - 1]
    if (last === undefined) return
    setShapes(shapes.slice(0, -1))
    setRedoStack([...redoStack, last])
  }
  const redo = () => {
    if (redoStack.length === 0) return
    const last = redoStack[redoStack.length - 1]
    if (last === undefined) return
    setRedoStack(redoStack.slice(0, -1))
    setShapes([...shapes, last])
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

  // Keyboard: Ctrl+Z / Ctrl+Y / Ctrl+C / Ctrl+S.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textDraft !== null) return
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textDraft, shapes, redoStack])

  const reveal = () => {
    if (savedPath !== null) void window.api?.editorReveal(savedPath)
  }

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

        <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />

        {/* Color palette */}
        <div className="flex items-center gap-1.5">
          {PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              onClick={() => setColor(hex)}
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
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="sr-only" />
          </label>
        </div>

        <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />

        {/* Stroke width */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#3BE6C0]">Épaisseur</span>
          <input
            type="range"
            min={2}
            max={40}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-28 accent-[#2BD9AC]"
          />
          <span className="w-6 text-right font-mono text-[11px] text-[#E7F3ED]/70">{width}</span>
        </div>

        <span className="mx-1 h-6 w-px bg-[#3BE6C022]" />

        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={shapes.length === 0} title="Annuler (Ctrl+Z)" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3BE6C012] text-[#E7F3ED] transition hover:bg-[#3BE6C024] disabled:opacity-35">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={redoStack.length === 0} title="Rétablir (Ctrl+Y)" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3BE6C012] text-[#E7F3ED] transition hover:bg-[#3BE6C024] disabled:opacity-35">
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
              style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
            />
            {textDraft !== null && (
              <input
                autoFocus
                type="text"
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
