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
export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shapesRef = useRef<Shape[]>([])
  const draftRef = useRef<Shape | null>(null)
  const idCounter = useRef(0)

  const [tool, setTool] = useState<ToolId>('select')
  const [color, setColor] = useState<string>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState<number>(4)
  const [opacity, setOpacity] = useState<number>(1)

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
    return () => {
      off1()
      off2()
      off3()
      off4()
      off5()
      off6()
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

    for (const shape of shapesRef.current) {
      drawShape(ctx, shape, w, h)
    }
    if (draftRef.current) {
      drawShape(ctx, draftRef.current, w, h)
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
      const text = window.prompt('Texte à insérer :', '') ?? ''
      if (text.trim().length > 0) {
        shapesRef.current.push({ ...base, kind: 'text', pos: pt, text })
        redraw()
      }
      draftRef.current = null
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
      if (shape.points.length === 0) break
      ctx.beginPath()
      const first = shape.points[0]
      if (!first) break
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < shape.points.length; i++) {
        const p = shape.points[i]
        if (p) ctx.lineTo(p.x, p.y)
      }
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
