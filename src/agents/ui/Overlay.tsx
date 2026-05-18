import { useEffect, useRef, useState } from 'react'

type ToolId = 'select' | 'pencil' | 'rectangle' | 'circle' | 'arrow' | 'text' | 'spotlight'

interface Point {
  x: number
  y: number
}

interface BaseShape {
  id: number
  color: string
  strokeWidth: number
  opacity: number
}

type Shape =
  | (BaseShape & { kind: 'pencil'; points: Point[] })
  | (BaseShape & { kind: 'rectangle'; from: Point; to: Point })
  | (BaseShape & { kind: 'circle'; from: Point; to: Point })
  | (BaseShape & { kind: 'arrow'; from: Point; to: Point })
  | (BaseShape & { kind: 'text'; pos: Point; text: string })
  | (BaseShape & { kind: 'spotlight'; center: Point; radius: number })

/**
 * Fullscreen transparent canvas. Every shape drawn here is part of the screen
 * pixels — visible to the user AND captured by any screen-share tool
 * (Google Meet, Zoom, Teams, OBS, etc.).
 *
 * Pointer events only fire on this window when the main process flips
 * `setIgnoreMouseEvents(false)` (the toolbar does that when a draw tool is
 * picked). Otherwise the overlay is fully click-through.
 */
interface CursorSample {
  x: number
  y: number
  t: number
}

const CURSOR_TRAIL_MS = 600
const CURSOR_TRAIL_MAX = 60

export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shapesRef = useRef<Shape[]>([])
  const draftRef = useRef<Shape | null>(null)
  const liveMasksRef = useRef<LiveMask[]>([])
  const cursorTrailRef = useRef<CursorSample[]>([])
  const cursorEnabledRef = useRef(false)
  const cursorOnThisDisplayRef = useRef(false)
  const cursorColorRef = useRef<string>('#22d3ee')
  const overlayOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const idCounter = useRef(0)
  const animationRef = useRef<number | null>(null)

  const [tool, setTool] = useState<ToolId>('select')
  const [color, setColor] = useState<string>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState<number>(4)
  const [opacity, setOpacity] = useState<number>(1)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null)

  // ----- IPC subscriptions from the toolbar -----
  useEffect(() => {
    const api = window.api
    if (!api) return
    const off1 = api.onSetTool((t) => setTool(t))
    const off2 = api.onSetColor((c) => setColor(c))
    const off3 = api.onSetOpacity((o) => setOpacity(o))
    const off4 = api.onSetStrokeWidth((w) => setStrokeWidth(w))
    const off5 = api.onClear(() => {
      shapesRef.current = []
      draftRef.current = null
      redraw()
    })
    const off6 = api.onUndo(() => {
      shapesRef.current.pop()
      redraw()
    })
    const off7 = api.onSetLiveMasks((zones) => {
      liveMasksRef.current = zones
      redraw()
    })
    const off8 = api.onClearLiveMasks(() => {
      liveMasksRef.current = []
      redraw()
    })
    const off9 = api.onCursorHighlight((enabled) => {
      cursorEnabledRef.current = enabled
      if (!enabled) {
        cursorTrailRef.current = []
        redraw()
      }
    })
    const off10b = api.onCursorColor((hex) => {
      cursorColorRef.current = hex
    })
    const off10 = api.onCursorPosition((pos) => {
      if (!cursorEnabledRef.current) return
      const origin = overlayOriginRef.current
      // Translate global screen coords → this overlay's local (CSS) frame.
      const localX = pos.screenX - origin.x
      const localY = pos.screenY - origin.y
      const w = window.innerWidth
      const h = window.innerHeight
      const onThisDisplay = localX >= 0 && localX <= w && localY >= 0 && localY <= h
      cursorOnThisDisplayRef.current = onThisDisplay
      if (onThisDisplay) {
        cursorTrailRef.current.push({ x: localX, y: localY, t: pos.timestamp })
        if (cursorTrailRef.current.length > CURSOR_TRAIL_MAX) {
          cursorTrailRef.current.shift()
        }
      }
    })
    return () => {
      off1()
      off2()
      off3()
      off4()
      off5()
      off6()
      off7()
      off8()
      off9()
      off10b()
      off10()
    }
  }, [])

  // Each overlay needs to know its display origin to translate global cursor
  // coordinates into its own local frame. We infer that from window.screenX/Y.
  useEffect(() => {
    const update = () => {
      overlayOriginRef.current = { x: window.screenX, y: window.screenY }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Continuous redraw loop when cursor highlight is on (trail decays over time)
  useEffect(() => {
    const loop = () => {
      if (cursorEnabledRef.current) {
        // Trim expired samples
        const now = Date.now()
        cursorTrailRef.current = cursorTrailRef.current.filter(
          (s) => now - s.t < CURSOR_TRAIL_MS
        )
        redraw()
      }
      animationRef.current = window.requestAnimationFrame(loop)
    }
    animationRef.current = window.requestAnimationFrame(loop)
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [])

  // ----- Canvas sizing -----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
      redraw()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // ----- Rendering -----
  const redraw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = window.innerWidth
    const h = window.innerHeight
    ctx.clearRect(0, 0, w, h)

    // 1. Live sanitizer masks — drawn FIRST so any manual annotation can sit
    //    on top. Coordinates arrive in absolute screen-pixel space (the
    //    sanitizer captures the primary display, whose top-left is the
    //    desktop's 0,0); each overlay translates to its own local frame
    //    via overlayOriginRef and only draws masks that intersect.
    const origin = overlayOriginRef.current
    for (const mask of liveMasksRef.current) {
      const localX = mask.x - origin.x
      const localY = mask.y - origin.y
      if (
        localX + mask.width < 0 ||
        localY + mask.height < 0 ||
        localX > w ||
        localY > h
      ) {
        continue
      }
      drawLiveMask(ctx, { ...mask, x: localX, y: localY })
    }

    // 2. Manual annotations
    for (const shape of shapesRef.current) {
      drawShape(ctx, shape, w, h)
    }
    if (draftRef.current) {
      drawShape(ctx, draftRef.current, w, h)
    }

    // 3. Cursor highlight (trail + halo) drawn on top
    if (cursorEnabledRef.current && cursorOnThisDisplayRef.current) {
      drawCursorHighlight(ctx, cursorTrailRef.current, cursorColorRef.current)
    }
  }

  // ----- Pointer interactions -----
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'select') return
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const pt = { x: e.clientX, y: e.clientY }
    const base: BaseShape = {
      id: ++idCounter.current,
      color,
      strokeWidth,
      opacity
    }
    if (tool === 'pencil') {
      draftRef.current = { ...base, kind: 'pencil', points: [pt] }
    } else if (tool === 'rectangle') {
      draftRef.current = { ...base, kind: 'rectangle', from: pt, to: pt }
    } else if (tool === 'circle') {
      draftRef.current = { ...base, kind: 'circle', from: pt, to: pt }
    } else if (tool === 'arrow') {
      draftRef.current = { ...base, kind: 'arrow', from: pt, to: pt }
    } else if (tool === 'spotlight') {
      draftRef.current = { ...base, kind: 'spotlight', center: pt, radius: 0 }
    } else if (tool === 'text') {
      // Inline text input — better UX than window.prompt in a click-through window.
      setTextInput({ x: pt.x, y: pt.y, value: '' })
      draftRef.current = null
      return
    }
    redraw()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current
    if (!draft) return
    const pt = { x: e.clientX, y: e.clientY }
    if (draft.kind === 'pencil') {
      draft.points.push(pt)
    } else if (draft.kind === 'rectangle' || draft.kind === 'circle' || draft.kind === 'arrow') {
      draft.to = pt
    } else if (draft.kind === 'spotlight') {
      const dx = pt.x - draft.center.x
      const dy = pt.y - draft.center.y
      draft.radius = Math.sqrt(dx * dx + dy * dy)
    }
    redraw()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current
    if (draft) {
      // Drop pencil shapes with too few points (accidental taps)
      const keep =
        draft.kind === 'pencil'
          ? draft.points.length > 2
          : draft.kind === 'spotlight'
            ? draft.radius > 4
            : true
      if (keep) shapesRef.current.push(draft)
      draftRef.current = null
      redraw()
    }
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // The canvas only receives pointer events when `tool !== 'select'`.
  // We don't need to gate it here because the main process toggles
  // setIgnoreMouseEvents on the window itself.
  const commitTextInput = () => {
    if (textInput === null) return
    const value = textInput.value.trim()
    if (value.length > 0) {
      shapesRef.current.push({
        id: ++idCounter.current,
        color,
        strokeWidth,
        opacity,
        kind: 'text',
        pos: { x: textInput.x, y: textInput.y },
        text: value
      })
      redraw()
    }
    setTextInput(null)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        cursor: tool === 'select' ? 'default' : 'crosshair'
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {textInput !== null && (
        <input
          autoFocus
          type="text"
          value={textInput.value}
          onChange={(e) =>
            setTextInput({ ...textInput, value: e.target.value })
          }
          onBlur={commitTextInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTextInput()
            if (e.key === 'Escape') setTextInput(null)
          }}
          placeholder="Saisis ton texte… (Entrée pour valider)"
          style={{
            position: 'absolute',
            left: textInput.x,
            top: textInput.y,
            minWidth: 220,
            padding: '6px 10px',
            borderRadius: 8,
            border: `2px solid ${color}`,
            background: 'rgba(10, 22, 40, 0.85)',
            color: '#fff',
            fontSize: Math.max(14, strokeWidth * 4),
            fontFamily: 'Inter, system-ui, sans-serif',
            outline: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            pointerEvents: 'auto'
          }}
        />
      )}
    </div>
  )
}

// ---------- Drawing primitives ----------

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  canvasW: number,
  canvasH: number
): void {
  ctx.save()
  ctx.globalAlpha = shape.opacity
  ctx.strokeStyle = shape.color
  ctx.fillStyle = shape.color
  ctx.lineWidth = shape.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (shape.kind) {
    case 'pencil': {
      const pts = shape.points
      if (pts.length === 0) break
      ctx.beginPath()
      const first = pts[0]
      if (!first) break
      if (pts.length === 1) {
        // Single tap → small dot
        ctx.arc(first.x, first.y, shape.strokeWidth / 2, 0, Math.PI * 2)
        ctx.fillStyle = shape.color
        ctx.fill()
        break
      }
      // Quadratic-curve smoothing: each control point is a sample, each
      // anchor sits at the midpoint of consecutive samples. Gives a much
      // smoother stroke than naive lineTo through every raw pointer event.
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < pts.length - 1; i++) {
        const cur = pts[i]
        const next = pts[i + 1]
        if (!cur || !next) continue
        const midX = (cur.x + next.x) / 2
        const midY = (cur.y + next.y) / 2
        ctx.quadraticCurveTo(cur.x, cur.y, midX, midY)
      }
      const last = pts[pts.length - 1]
      if (last) ctx.lineTo(last.x, last.y)
      ctx.stroke()
      break
    }
    case 'rectangle': {
      const x = Math.min(shape.from.x, shape.to.x)
      const y = Math.min(shape.from.y, shape.to.y)
      const w = Math.abs(shape.to.x - shape.from.x)
      const h = Math.abs(shape.to.y - shape.from.y)
      ctx.strokeRect(x, y, w, h)
      break
    }
    case 'circle': {
      const cx = (shape.from.x + shape.to.x) / 2
      const cy = (shape.from.y + shape.to.y) / 2
      const rx = Math.abs(shape.to.x - shape.from.x) / 2
      const ry = Math.abs(shape.to.y - shape.from.y) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'arrow': {
      drawArrow(ctx, shape.from, shape.to, shape.strokeWidth)
      break
    }
    case 'text': {
      const fontSize = Math.max(14, shape.strokeWidth * 4)
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
      ctx.textBaseline = 'top'
      // White outline for legibility on any background
      ctx.lineWidth = Math.max(2, fontSize / 8)
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.strokeText(shape.text, shape.pos.x, shape.pos.y)
      ctx.fillStyle = shape.color
      ctx.fillText(shape.text, shape.pos.x, shape.pos.y)
      break
    }
    case 'spotlight': {
      // Darken the whole canvas, then cut a clear circle around the center.
      ctx.save()
      ctx.fillStyle = `rgba(0,0,0,${0.55 * shape.opacity})`
      ctx.fillRect(0, 0, canvasW, canvasH)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      // Outline ring in selected color so the focus area is highlighted
      ctx.beginPath()
      ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2)
      ctx.strokeStyle = shape.color
      ctx.lineWidth = Math.max(2, shape.strokeWidth / 2)
      ctx.stroke()
      break
    }
  }

  ctx.restore()
}

function drawCursorHighlight(
  ctx: CanvasRenderingContext2D,
  trail: CursorSample[],
  color: string
): void {
  if (trail.length === 0) return
  const last = trail[trail.length - 1]
  if (!last) return
  const rgb = hexToRgb(color)
  ctx.save()

  // Smooth fading trail (older samples are more transparent + thinner)
  if (trail.length >= 2) {
    const now = Date.now()
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1]
      const b = trail[i]
      if (!a || !b) continue
      const age = now - b.t
      const t = Math.max(0, 1 - age / CURSOR_TRAIL_MS)
      ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.6 * t})`
      ctx.lineWidth = 2 + 4 * t
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }

  // Big glowing halo around the current cursor point
  const grd = ctx.createRadialGradient(last.x, last.y, 4, last.x, last.y, 36)
  grd.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.55)`)
  grd.addColorStop(0.4, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`)
  grd.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(last.x, last.y, 36, 0, Math.PI * 2)
  ctx.fill()

  // Crisp inner ring
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.95)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(last.x, last.y, 10, 0, Math.PI * 2)
  ctx.stroke()

  ctx.restore()
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').padEnd(6, '0')
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0
  }
}

function drawLiveMask(ctx: CanvasRenderingContext2D, mask: LiveMask): void {
  ctx.save()
  // Solid black panel — completely covers the underlying pixels
  ctx.fillStyle = 'rgba(0, 0, 0, 0.96)'
  ctx.fillRect(mask.x, mask.y, mask.width, mask.height)
  // Red dashed border so the user notices the masked zone
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 4])
  ctx.strokeRect(mask.x + 0.5, mask.y + 0.5, mask.width - 1, mask.height - 1)
  ctx.setLineDash([])
  // Pattern label baked top-left
  const fontSize = Math.min(11, Math.max(9, Math.floor(mask.height * 0.55)))
  if (mask.height >= 14) {
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(239, 68, 68, 0.95)'
    ctx.fillText(`🛡 ${mask.label}`, mask.x + 4, mask.y + 2)
  }
  ctx.restore()
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  strokeWidth: number
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const headLen = Math.max(12, strokeWidth * 3.5)
  const headAngle = Math.PI / 7

  // Shaft (shortened a bit so the head fits cleanly at the tip)
  const shaftEnd = {
    x: to.x - Math.cos(angle) * headLen * 0.6,
    y: to.y - Math.sin(angle) * headLen * 0.6
  }
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(shaftEnd.x, shaftEnd.y)
  ctx.stroke()

  // Filled triangular head
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - headLen * Math.cos(angle - headAngle),
    to.y - headLen * Math.sin(angle - headAngle)
  )
  ctx.lineTo(
    to.x - headLen * Math.cos(angle + headAngle),
    to.y - headLen * Math.sin(angle + headAngle)
  )
  ctx.closePath()
  ctx.fill()
}
