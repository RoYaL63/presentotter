import { useEffect, useRef, useState } from 'react'
import { Droplet, X } from 'lucide-react'

type ToolId =
  | 'select'
  | 'pencil'
  | 'ephemeral'
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'text'
  | 'spotlight'
  | 'blur'

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

/** A point on an ephemeral stroke remembers when it was drawn so the
 *  fade can wash over the stroke from the oldest end to the newest. */
interface TimedPoint extends Point {
  t: number
}

type Shape =
  | (BaseShape & { kind: 'pencil'; points: Point[] })
  | (BaseShape & {
      kind: 'ephemeral'
      points: TimedPoint[]
      /** Per-stroke override of the global EPHEMERAL_LIFE_MS so the
       *  user can adjust "how long it stays" without affecting strokes
       *  already on screen. Captured at pointer-down. */
      lifeMs: number
    })
  | (BaseShape & { kind: 'rectangle'; from: Point; to: Point })
  | (BaseShape & { kind: 'circle'; from: Point; to: Point })
  | (BaseShape & { kind: 'arrow'; from: Point; to: Point })
  | (BaseShape & { kind: 'text'; pos: Point; text: string })
  | (BaseShape & { kind: 'spotlight'; center: Point; radius: number })
  // Manual privacy box — a persistent frosted rectangle the user drags
  // over anything they want hidden during a screen share. Drawn on the
  // canvas (real pixels → captured by Meet/Zoom), zero CPU, 100%
  // reliable, independent of OCR. The "présente et floute si besoin"
  // escape hatch when the auto sanitizer misses something.
  | (BaseShape & { kind: 'blur'; from: Point; to: Point })

/** Default total visible lifetime of an ephemeral stroke (full alpha → 0).
 *  Per-stroke value is set at pointer-down from the user setting. */
const DEFAULT_EPHEMERAL_LIFE_MS = 5000
/** Fraction of the per-stroke lifetime spent fading out. The first
 *  (1 - FADE_RATIO) of the life is at full alpha; the rest scales
 *  smoothly to 0. Same proportion regardless of total duration so a
 *  short stroke and a long one share the same "feel". */
const EPHEMERAL_FADE_RATIO = 0.35

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

// CURSOR_TRAIL_MAX caps the in-memory ring buffer; the actual fade window
// comes from the Tools page (settable) and is read via cursorTrailMsRef.
const CURSOR_TRAIL_MAX = 90

/**
 * Meteor particle — independent of the cursor sample buffer. Each is a
 * soft glowing blob that drifts behind the cursor and fades over its
 * lifetime, giving the smooth comet-tail effect (no visible polyline
 * segments / pixelation).
 */
interface MeteorParticle {
  x: number
  y: number
  vx: number
  vy: number
  birth: number
  size: number
}
const PARTICLE_POOL_MAX = 600

export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const shapesRef = useRef<Shape[]>([])
  const draftRef = useRef<Shape | null>(null)
  const liveMasksRef = useRef<LiveMask[]>([])
  const cursorTrailRef = useRef<CursorSample[]>([])
  const particlesRef = useRef<MeteorParticle[]>([])
  const cursorEnabledRef = useRef(false)
  const cursorOnThisDisplayRef = useRef(false)
  const cursorColorRef = useRef<string>('#22d3ee')
  const cursorStyleRef = useRef<'meteor' | 'classic' | 'minimal'>('meteor')
  const cursorTrailMsRef = useRef<number>(900)
  const cursorIntensityRef = useRef<number>(1)
  const cursorSizeRef = useRef<number>(1)
  // Lifetime of the next ephemeral stroke, in ms. Driven by the user
  // setting (Tools → Surligneur éphémère). Strokes already on screen
  // keep the value they were created with — see `lifeMs` on the shape.
  const ephemeralLifeMsRef = useRef<number>(DEFAULT_EPHEMERAL_LIFE_MS)
  // Spotlight tool — when active, redraw() paints a dark wash + clear
  // circle that follows the live cursor position. Independent from the
  // cursor-highlight visual (the user can have either, neither, or both).
  const spotlightActiveRef = useRef<boolean>(false)
  const spotlightStrokeRef = useRef<number>(4)
  // Screen-space rectangle of the floating toolbar window (or null when
  // hidden). When the user starts a stroke inside this rect, we skip it
  // — otherwise the stroke would render UNDER the toolbar and look like
  // the pencil writes "through" the buttons.
  const toolbarRectRef = useRef<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  // Live sanitizer masks render as DOM nodes (CSS backdrop-filter blur of the
  // pixels behind the overlay) rather than canvas fills — gives a real
  // frosted-glass blur on the secret, not an opaque black rectangle.
  const [liveMasks, setLiveMasks] = useState<LiveMask[]>([])
  // The overlay is click-through in select/spotlight mode, so a mask's ✕
  // can't be clicked unless we momentarily make the window interactive
  // while the cursor hovers it. toolRef tells us the "base" interactivity
  // (drawing tools already capture the pointer), closeHoverRef tracks
  // whether we're currently over a ✕ so we only toggle on real changes.
  const toolRef = useRef<ToolId>('select')
  const closeHoverRef = useRef(false)
  const overlayOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const idCounter = useRef(0)
  const animationRef = useRef<number | null>(null)

  const [tool, setTool] = useState<ToolId>('select')
  const [color, setColor] = useState<string>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState<number>(4)
  const [opacity, setOpacity] = useState<number>(1)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null)
  // Debug OCR overlay — when on, every word Tesseract returned is drawn
  // as a thin outlined box so the user can verify what the engine sees.
  const [debugOcr, setDebugOcr] = useState<boolean>(false)
  const [ocrWords, setOcrWords] = useState<
    Array<{ x: number; y: number; width: number; height: number; text: string }>
  >([])

  // ----- IPC subscriptions from the toolbar -----
  useEffect(() => {
    const api = window.api
    if (!api) return
    const off1 = api.onSetTool((t) => {
      setTool(t)
      toolRef.current = t
    })
    const off2 = api.onSetColor((c) => setColor(c))
    const off3 = api.onSetOpacity((o) => setOpacity(o))
    const off4 = api.onSetStrokeWidth((w) => {
      setStrokeWidth(w)
      spotlightStrokeRef.current = w
    })
    const off4b = api.onSetEphemeralLifeMs((ms) => {
      // Clamp at the receive boundary too — defensive against any
      // future caller that forgets the store's own clamp.
      ephemeralLifeMsRef.current = Math.max(2000, Math.min(20000, Math.round(ms)))
    })
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
      // Cap the rendered masks so a pathological OCR result cannot explode
      // the React tree. 30 covers every realistic 'leak the whole .env' case.
      const capped = zones.length > 30 ? zones.slice(0, 30) : zones
      if ((globalThis as { __PRESENTOTTER_DEBUG?: boolean }).__PRESENTOTTER_DEBUG === true) {
        console.warn(
          `[overlay] received ${zones.length} live mask(s) (rendering ${capped.length}) · screenX=${window.screenX},screenY=${window.screenY} · innerSize=${window.innerWidth}x${window.innerHeight}`,
          capped.slice(0, 3)
        )
      }
      liveMasksRef.current = capped
      setLiveMasks(capped)
    })
    const off8 = api.onClearLiveMasks(() => {
      liveMasksRef.current = []
      setLiveMasks([])
    })
    const off8b = api.onSetLiveOcrWords((words) => {
      setOcrWords(words.length > 1000 ? words.slice(0, 1000) : words)
    })
    const off8c = api.onClearLiveOcrWords(() => setOcrWords([]))
    const off8d = api.onSetToolbarRect((rect) => {
      toolbarRectRef.current = rect
    })
    const off9 = api.onCursorHighlight((enabled) => {
      cursorEnabledRef.current = enabled
      if (!enabled) {
        cursorTrailRef.current = []
        redraw()
      } else {
        kickAnimationRef.current()
      }
    })
    const off9b = api.onSpotlightActive((active) => {
      spotlightActiveRef.current = active
      if (!active) {
        if (!cursorEnabledRef.current) cursorTrailRef.current = []
        redraw()
      } else {
        kickAnimationRef.current()
      }
    })
    const off10b = api.onCursorColor((hex) => {
      cursorColorRef.current = hex
    })
    const off10c = api.onCursorSettings((s) => {
      cursorColorRef.current = s.color
      cursorStyleRef.current = s.style
      cursorTrailMsRef.current = s.trailLengthMs
      cursorIntensityRef.current = s.intensity
      cursorSizeRef.current = s.size
    })
    const off10 = api.onCursorPosition((pos) => {
      // We need the cursor sample for the meteor highlight AND the
      // spotlight tool. Either is enough to keep processing samples.
      if (!cursorEnabledRef.current && !spotlightActiveRef.current) return
      // Make sure the rAF pump is running while we have fresh samples
      // to consume — it self-stops when idle, this revives it.
      kickAnimationRef.current()
      const origin = overlayOriginRef.current
      // Translate global screen coords → this overlay's local (CSS) frame.
      const localX = pos.screenX - origin.x
      const localY = pos.screenY - origin.y
      const w = window.innerWidth
      const h = window.innerHeight
      const onThisDisplay = localX >= 0 && localX <= w && localY >= 0 && localY <= h
      cursorOnThisDisplayRef.current = onThisDisplay
      if (onThisDisplay) {
        const prev =
          cursorTrailRef.current[cursorTrailRef.current.length - 1] ?? null
        cursorTrailRef.current.push({ x: localX, y: localY, t: pos.timestamp })
        if (cursorTrailRef.current.length > CURSOR_TRAIL_MAX) {
          cursorTrailRef.current.shift()
        }

        // Spawn meteor particles along the segment from the previous
        // sample to this one — density scales with cursor speed so a
        // slow drift produces a thin trail, a fast flick produces a
        // dense comet tail.
        if (cursorStyleRef.current === 'meteor' && prev !== null) {
          const dx = localX - prev.x
          const dy = localY - prev.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 0.5) {
            const count = Math.min(14, Math.max(2, Math.floor(dist / 5)))
            // Slight drift "behind" the cursor (opposite to motion)
            // gives the tail its lag; the jitter is what makes it look
            // organic instead of mechanical.
            const driftX = -dx * 0.015
            const driftY = -dy * 0.015
            for (let i = 0; i < count; i++) {
              const t = i / count
              particlesRef.current.push({
                x: prev.x + dx * t + (Math.random() - 0.5) * 4,
                y: prev.y + dy * t + (Math.random() - 0.5) * 4,
                vx: driftX + (Math.random() - 0.5) * 0.4,
                vy: driftY + (Math.random() - 0.5) * 0.4,
                birth: pos.timestamp,
                size: 5 + Math.random() * 10
              })
            }
            // Cap the pool so very long fast moves don't unbound mem.
            if (particlesRef.current.length > PARTICLE_POOL_MAX) {
              particlesRef.current.splice(
                0,
                particlesRef.current.length - PARTICLE_POOL_MAX
              )
            }
          }
        }
      }
    })
    return () => {
      off1()
      off2()
      off3()
      off4()
      off4b()
      off5()
      off6()
      off7()
      off8()
      off8b()
      off8c()
      off8d()
      off9()
      off9b()
      off10b()
      off10c()
      off10()
    }
  }, [])

  // Hydrate the OCR-debug flag from localStorage so the overlay knows
  // whether to render OCR word boxes. Also listen to the storage event
  // so when the user toggles the flag from the Home Tools section, the
  // overlay reacts immediately.
  useEffect(() => {
    const STORAGE_KEY = 'presentotter:tool-settings:v1'
    const apply = (raw: string | null): void => {
      if (raw === null) return
      try {
        const parsed = JSON.parse(raw) as {
          sanitizer?: { debugOcr?: boolean }
        }
        setDebugOcr(parsed?.sanitizer?.debugOcr === true)
      } catch {
        /* ignore malformed JSON */
      }
    }
    apply(localStorage.getItem(STORAGE_KEY))
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== STORAGE_KEY) return
      apply(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
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

  // Make a mask's ✕ clickable on the otherwise click-through overlay.
  // In select/spotlight mode the window ignores the mouse (forward:true),
  // so it still delivers move events: when the cursor is over a ✕ we flip
  // the window interactive, and back to click-through when it leaves. In a
  // drawing tool the window is already interactive, so we leave it alone.
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const base =
        toolRef.current !== 'select' && toolRef.current !== 'spotlight'
      if (base) return
      if (liveMasksRef.current.length === 0) {
        if (closeHoverRef.current) {
          closeHoverRef.current = false
          window.api?.setOverlayInteractive(false)
        }
        return
      }
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const overClose =
        el instanceof Element && el.closest('[data-mask-close]') !== null
      if (overClose !== closeHoverRef.current) {
        closeHoverRef.current = overClose
        window.api?.setOverlayInteractive(overClose)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (closeHoverRef.current) {
        closeHoverRef.current = false
        window.api?.setOverlayInteractive(false)
      }
    }
  }, [])

  // Animation pump — only runs when something is actually animating
  // (cursor highlight OR spotlight follow OR meteor particles still
  // decaying). When the user disables both, the loop stops itself and
  // we drop to zero CPU. kickAnimation() restarts it on demand.
  const kickAnimationRef = useRef<() => void>(() => {})
  useEffect(() => {
    const loop = (): void => {
      // Active = cursor halo on, OR spotlight following, OR there are
      // still ephemeral strokes that haven't fully faded out.
      const hasEphemeral = shapesRef.current.some(
        (s) => s.kind === 'ephemeral'
      )
      const active =
        cursorEnabledRef.current ||
        spotlightActiveRef.current ||
        hasEphemeral
      if (!active && particlesRef.current.length === 0) {
        animationRef.current = null
        return
      }
      const now = Date.now()
      const ttl = cursorTrailMsRef.current
      cursorTrailRef.current = cursorTrailRef.current.filter((s) => now - s.t < ttl)
      particlesRef.current = particlesRef.current.filter((p) => now - p.birth < ttl)
      // Prune ephemeral strokes whose last point is now older than the
      // shape's lifeMs. The stroke fades tail-first; we only drop the
      // shape once even its newest point would render at alpha 0.
      // Doing the prune here, not inside drawShape, keeps the redraw
      // idempotent (no shape disappears mid-render).
      if (hasEphemeral) {
        const perfNow = performance.now()
        shapesRef.current = shapesRef.current.filter((s) => {
          if (s.kind !== 'ephemeral') return true
          const last = s.points[s.points.length - 1]
          if (!last) return false
          return perfNow - last.t < s.lifeMs
        })
      }
      redraw()
      animationRef.current = window.requestAnimationFrame(loop)
    }
    const kick = (): void => {
      if (animationRef.current === null) {
        animationRef.current = window.requestAnimationFrame(loop)
      }
    }
    kickAnimationRef.current = kick
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

    // Live sanitizer masks are rendered as DOM elements (see JSX below) with
    // backdrop-filter blur, not canvas fills — so the masked pixels behind
    // the overlay are actually frosted, not hidden under a black rectangle.

    // 2. Manual annotations
    for (const shape of shapesRef.current) {
      drawShape(ctx, shape, w, h)
    }
    if (draftRef.current) {
      drawShape(ctx, draftRef.current, w, h)
    }

    // 2b. Live spotlight following the cursor — draws AFTER annotations
    // so the dark wash darkens them too (the focus area always stays
    // legible because the hole is fully clear). Skipped if the cursor
    // isn't on this display so we don't dim the overlay all alone.
    if (spotlightActiveRef.current && cursorOnThisDisplayRef.current) {
      const head = cursorTrailRef.current[cursorTrailRef.current.length - 1]
      if (head) {
        drawSpotlight(ctx, head.x, head.y, w, h, spotlightStrokeRef.current)
      }
    }

    // 3. Cursor highlight (trail + halo) drawn on top
    if (cursorEnabledRef.current && cursorOnThisDisplayRef.current) {
      drawCursorHighlight(
        ctx,
        cursorTrailRef.current,
        particlesRef.current,
        cursorColorRef.current,
        cursorStyleRef.current,
        cursorTrailMsRef.current,
        cursorIntensityRef.current,
        cursorSizeRef.current
      )
    }
  }

  // ----- Pointer interactions -----
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'select') return
    // If the click started inside the floating toolbar's screen area,
    // do nothing. The toolbar lives in its own BrowserWindow so the
    // click already routed there; ignoring it here also stops a stroke
    // from being created underneath the toolbar.
    const toolbarRect = toolbarRectRef.current
    if (toolbarRect !== null) {
      const screenX = e.clientX + window.screenX
      const screenY = e.clientY + window.screenY
      if (
        screenX >= toolbarRect.x &&
        screenX <= toolbarRect.x + toolbarRect.width &&
        screenY >= toolbarRect.y &&
        screenY <= toolbarRect.y + toolbarRect.height
      ) {
        return
      }
    }
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
    } else if (tool === 'ephemeral') {
      // Ephemeral stroke: every point carries its own timestamp so the
      // fade washes over the stroke from the oldest end to the newest
      // (not the whole shape dropping at once). lifeMs is snapshotted
      // here so changing the setting mid-stroke doesn't shorten the
      // current one.
      const now = performance.now()
      draftRef.current = {
        ...base,
        kind: 'ephemeral',
        points: [{ x: pt.x, y: pt.y, t: now }],
        lifeMs: ephemeralLifeMsRef.current
      }
    } else if (tool === 'rectangle') {
      draftRef.current = { ...base, kind: 'rectangle', from: pt, to: pt }
    } else if (tool === 'blur') {
      draftRef.current = { ...base, kind: 'blur', from: pt, to: pt }
    } else if (tool === 'circle') {
      draftRef.current = { ...base, kind: 'circle', from: pt, to: pt }
    } else if (tool === 'arrow') {
      draftRef.current = { ...base, kind: 'arrow', from: pt, to: pt }
    } else if (tool === 'spotlight') {
      // Spotlight is no longer a draggable shape; it follows the cursor
      // live (rendered in redraw() from the cursor sample stream). Click
      // does nothing, drag does nothing.
      return
    } else if (tool === 'text') {
      // Inline text input — better UX than window.prompt in a click-through window.
      // The overlay starts as focusable: false; even after toolbar flips it
      // to true, the click that gets us here did not necessarily give the
      // window keyboard focus. Ask main to explicitly focus this overlay so
      // the <input> below actually receives keystrokes.
      window.api?.requestOverlayFocus()
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
    } else if (draft.kind === 'ephemeral') {
      // Timestamped point so each segment of the stroke fades on its
      // own schedule. performance.now() is monotonic and matches what
      // we read in the redraw loop, so the math stays stable.
      draft.points.push({ x: pt.x, y: pt.y, t: performance.now() })
    } else if (
      draft.kind === 'rectangle' ||
      draft.kind === 'circle' ||
      draft.kind === 'arrow' ||
      draft.kind === 'blur'
    ) {
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
      // Drop pencil-family shapes with too few points (accidental taps)
      // and zero-area blur boxes (a click without a drag).
      const keep =
        draft.kind === 'pencil' || draft.kind === 'ephemeral'
          ? draft.points.length > 2
          : draft.kind === 'spotlight'
            ? draft.radius > 4
            : draft.kind === 'blur'
              ? Math.abs(draft.to.x - draft.from.x) > 8 &&
                Math.abs(draft.to.y - draft.from.y) > 8
              : true
      if (keep) {
        shapesRef.current.push(draft)
        // Ephemeral shapes need the rAF pump to drive their fade-out;
        // kick it so the redraw loop starts (or stays) running.
        if (draft.kind === 'ephemeral') kickAnimationRef.current()
      }
      draftRef.current = null
      redraw()
    }
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // The canvas only receives pointer events when `tool !== 'select'`.
  // We don't need to gate it here because the main process toggles
  // setIgnoreMouseEvents on the window itself.
  // Remove a single sanitizer mask. Drop it locally for instant feedback,
  // then tell the toolbar so its detector suppresses the region instead of
  // re-masking it on the next scan.
  const dismissMask = (mask: LiveMask): void => {
    const remaining = liveMasksRef.current.filter((m) => m !== mask)
    liveMasksRef.current = remaining
    setLiveMasks(remaining)
    window.api?.dismissLiveMask({
      x: mask.x,
      y: mask.y,
      width: mask.width,
      height: mask.height
    })
  }

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
        onContextMenu={(e) => {
          // Right-click on the overlay = undo last annotation. Saves
          // the user from having to reach the toolbar's Undo button
          // while drawing. Block the default OS context menu so it
          // doesn't pop up on top.
          e.preventDefault()
          if (draftRef.current !== null) {
            draftRef.current = null
            redraw()
            return
          }
          if (shapesRef.current.length > 0) {
            shapesRef.current.pop()
            redraw()
          }
        }}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* OCR debug — thin outlines around every word Tesseract returned.
          Useful when "the sanitizer didn't mask my secret" to figure out
          whether the OCR even read the text. Off by default; toggled
          from Tools → Sanitizer → Mode debug OCR. */}
      {debugOcr &&
        ocrWords.map((w, idx) => {
          const localX = w.x - overlayOriginRef.current.x
          const localY = w.y - overlayOriginRef.current.y
          if (
            localX + w.width < 0 ||
            localY + w.height < 0 ||
            localX > window.innerWidth ||
            localY > window.innerHeight
          ) {
            return null
          }
          return (
            <div
              key={`ocr-${idx}-${w.x}-${w.y}`}
              style={{
                position: 'absolute',
                left: localX,
                top: localY,
                width: w.width,
                height: w.height,
                border: '1px solid rgba(74, 124, 89, 0.85)', // kelp
                borderRadius: 2,
                background: 'rgba(74, 124, 89, 0.10)',
                pointerEvents: 'none'
              }}
              aria-hidden
            />
          )
        })}

      {/* Live sanitizer masks — DOM layer with an opaque "deep water"
          gradient that reliably hides the pixels behind (a transparent
          Electron overlay has no opaque siblings to blur, so backdrop-filter
          is a no-op — and animating it on every scan caused freezes). The
          aquatic look is pure static CSS: a teal gradient + caustic sheen +
          a thin wave line. Each mask carries a ✕ to dismiss it; the hover
          bridge above flips the window interactive so the click lands.
          Coords are translated from absolute screen space to local. */}
      {liveMasks.map((mask, idx) => {
        const localX = mask.x - overlayOriginRef.current.x
        const localY = mask.y - overlayOriginRef.current.y
        if (
          localX + mask.width < 0 ||
          localY + mask.height < 0 ||
          localX > window.innerWidth ||
          localY > window.innerHeight
        ) {
          return null
        }
        const showLabel = mask.height >= 18
        const showWave = mask.height >= 24
        const showClose = mask.width >= 28 && mask.height >= 16
        return (
          <div
            key={`live-mask-${idx}-${mask.x}-${mask.y}`}
            style={{
              position: 'absolute',
              left: localX,
              top: localY,
              width: mask.width,
              height: mask.height,
              background:
                'linear-gradient(155deg, rgba(7,42,63,0.97) 0%, rgba(10,74,92,0.96) 48%, rgba(17,116,120,0.95) 100%)',
              border: '1.5px solid rgba(140,228,236,0.6)',
              borderRadius: 10,
              boxShadow:
                'inset 0 1px 0 rgba(200,248,252,0.35), inset 0 -10px 16px rgba(3,26,40,0.55), 0 6px 18px rgba(6,38,56,0.45)',
              pointerEvents: 'none',
              overflow: 'hidden'
            }}
            aria-label={`Zone masquée : ${mask.label}`}
          >
            {/* Caustic sheen — soft light at the surface, deeper teal below. */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage:
                  'radial-gradient(130% 80% at 12% -20%, rgba(190,244,250,0.20), transparent 55%), radial-gradient(90% 70% at 95% 130%, rgba(34,150,160,0.34), transparent 60%)',
                pointerEvents: 'none'
              }}
              aria-hidden
            />
            {/* Water-surface ripple near the bottom. */}
            {showWave && (
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none' }}
                aria-hidden
              >
                <path
                  d="M0,72 Q25,62 50,72 T100,72"
                  fill="none"
                  stroke="rgba(176,238,245,0.5)"
                  strokeWidth="1.4"
                />
                <path
                  d="M0,84 Q25,76 50,84 T100,84"
                  fill="none"
                  stroke="rgba(120,210,220,0.4)"
                  strokeWidth="1.2"
                />
              </svg>
            )}
            {showLabel && (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: 6,
                  right: showClose ? 22 : 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#DFFAFF',
                  textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                  letterSpacing: 0.2,
                  pointerEvents: 'none'
                }}
              >
                <Droplet size={10} strokeWidth={2.25} style={{ flexShrink: 0 }} />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {mask.label}
                </span>
              </span>
            )}
            {showClose && (
              <button
                type="button"
                data-mask-close="1"
                title="Retirer ce masque"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  dismissMask(mask)
                }}
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 15,
                  height: 15,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9999,
                  background: 'rgba(6,28,40,0.82)',
                  border: '1px solid rgba(150,232,240,0.75)',
                  color: '#E8FCFF',
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                  lineHeight: 0
                }}
              >
                <X size={9} strokeWidth={3} />
              </button>
            )}
          </div>
        )
      })}

      {textInput !== null && (
        <input
          ref={(el) => {
            textInputRef.current = el
            if (el !== null) {
              // autoFocus only fires once at mount and relies on the window
              // having keyboard focus already, which is not guaranteed here.
              // Re-focus on each render of the input and on the next frame
              // (after the focus IPC has had a chance to land in main).
              el.focus()
              window.requestAnimationFrame(() => el.focus())
            }
          }}
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
            background: 'rgba(10, 22, 40, 0.95)',
            color: '#fff',
            fontSize: Math.max(14, strokeWidth * 4),
            fontFamily: 'Inter, system-ui, sans-serif',
            outline: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            pointerEvents: 'auto',
            // Without an explicit z-index, the input sometimes renders below
            // the canvas when the canvas is repainted during the same frame.
            zIndex: 100
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
    case 'ephemeral': {
      const pts = shape.points
      if (pts.length === 0) break
      // Per-segment alpha: each segment fades on the schedule of its
      // OWN points, so the oldest end of the stroke goes invisible
      // first while the newest end is still at full opacity. Hence
      // we draw segment-by-segment (no batched single-Path stroke).
      //
      // life of each point:
      //   age < holdFor          → alpha = 1
      //   age in [holdFor, life] → alpha linear 1 → 0
      //   age >= life            → alpha = 0  (segment skipped)
      const now = performance.now()
      const lifeMs = shape.lifeMs
      const fadeMs = Math.max(200, Math.round(lifeMs * EPHEMERAL_FADE_RATIO))
      const holdFor = lifeMs - fadeMs
      // Meteor-ish glow: shadow on the stroke gives a soft outer halo
      // in the shape's color, intensifying the "neon trail" feel and
      // making the line legible on any background.
      ctx.shadowBlur = 14
      ctx.shadowColor = shape.color

      const alphaFor = (t: number): number => {
        const age = now - t
        if (age <= holdFor) return 1
        if (age >= lifeMs) return 0
        return Math.max(0, 1 - (age - holdFor) / fadeMs)
      }

      const first = pts[0]
      if (!first) break
      if (pts.length === 1) {
        const a = alphaFor(first.t)
        if (a <= 0) break
        ctx.globalAlpha = shape.opacity * a
        ctx.beginPath()
        ctx.arc(first.x, first.y, shape.strokeWidth / 2, 0, Math.PI * 2)
        ctx.fillStyle = shape.color
        ctx.fill()
        break
      }
      // Each segment between consecutive samples gets its own alpha,
      // averaged from the two endpoints' ages. This gives a smooth
      // gradient along the stroke rather than visible bands at every
      // sample. The slight overdraw at the joins is invisible.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        if (!a || !b) continue
        const alpha = (alphaFor(a.t) + alphaFor(b.t)) * 0.5
        if (alpha <= 0.01) continue
        ctx.globalAlpha = shape.opacity * alpha
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
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
    case 'blur': {
      // Manual privacy box. Real canvas pixels (so screen-share tools
      // capture it), opaque so nothing leaks through. Aquatic look:
      // deep-water gradient + soft caustic hatch + aqua border, matching
      // the auto-sanitizer masks' visual language.
      const x = Math.min(shape.from.x, shape.to.x)
      const y = Math.min(shape.from.y, shape.to.y)
      const w = Math.abs(shape.to.x - shape.from.x)
      const h = Math.abs(shape.to.y - shape.from.y)
      ctx.save()
      // Solid deep-water gradient — guarantees the pixels underneath are hidden.
      const grad = ctx.createLinearGradient(x, y, x + w, y + h)
      grad.addColorStop(0, 'rgba(7, 42, 63, 0.98)')
      grad.addColorStop(0.5, 'rgba(10, 74, 92, 0.97)')
      grad.addColorStop(1, 'rgba(17, 116, 120, 0.96)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 10)
      ctx.fill()
      // Soft aqua caustic hatch so it reads as "under water", clipped to
      // the rounded box.
      ctx.clip()
      ctx.strokeStyle = 'rgba(176, 238, 245, 0.12)'
      ctx.lineWidth = 6
      for (let d = -h; d < w; d += 16) {
        ctx.beginPath()
        ctx.moveTo(x + d, y)
        ctx.lineTo(x + d + h, y + h)
        ctx.stroke()
      }
      ctx.restore()
      // Aqua border.
      ctx.save()
      ctx.strokeStyle = 'rgba(140, 228, 236, 0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 10)
      ctx.stroke()
      ctx.restore()
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

/**
 * Cursor highlight renderer.
 *
 * Three visual modes:
 *   - 'meteor' : particle-based glowing comet trail (additive blend),
 *                no polyline strokes → no visible segment pixelation
 *   - 'classic': single smooth stroke through trail samples, simple line
 *   - 'minimal': ring at the head only, no trail
 *
 * The meteor mode spawns its own particle pool from the cursor sample
 * stream (see Overlay's onCursorPosition handler) so it can be rendered
 * with `globalCompositeOperation = 'lighter'` for a real light-emission
 * effect — overlapping blobs add up, the head reads brighter than the
 * tail naturally.
 */
function drawCursorHighlight(
  ctx: CanvasRenderingContext2D,
  trail: CursorSample[],
  particles: MeteorParticle[],
  color: string,
  style: 'meteor' | 'classic' | 'minimal',
  trailMs: number,
  intensity: number,
  size: number
): void {
  if (trail.length === 0) return
  const head = trail[trail.length - 1]
  if (!head) return
  const rgb = hexToRgb(color)
  const now = Date.now()
  const k = Math.max(0, Math.min(1, intensity))
  // Clamp size to a sane range so we never get a halo larger than the
  // overlay or smaller than the cursor itself.
  const s = Math.max(0.4, Math.min(2.5, size))

  // ---- MINIMAL: precise ring, no trail, no halo ----
  if (style === 'minimal') {
    ctx.save()
    ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.95 * k})`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(head.x, head.y, 8 * s, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  // Soft outer halo behind the head (meteor + classic share this).
  ctx.save()
  const haloRadius = (style === 'meteor' ? 64 : 40) * s
  const outerHalo = ctx.createRadialGradient(head.x, head.y, 2, head.x, head.y, haloRadius)
  outerHalo.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.55 * k})`)
  outerHalo.addColorStop(0.35, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.22 * k})`)
  outerHalo.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
  ctx.fillStyle = outerHalo
  ctx.beginPath()
  ctx.arc(head.x, head.y, haloRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // ---- METEOR: particle-based comet tail ----
  if (style === 'meteor') {
    drawMeteorTail(ctx, particles, rgb, trailMs, k, s, now)
    drawCursorHead(ctx, head, rgb, k * 1.05, s)
    return
  }

  // ---- CLASSIC: single smooth stroke through samples ----
  if (trail.length < 2) {
    drawCursorHead(ctx, head, rgb, k, s)
    return
  }
  const N = trail.length
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = N - 1; i >= 1; i--) {
    const cur = trail[i]
    const prev = trail[i - 1]
    if (!cur || !prev) continue
    const positionT = i / (N - 1)
    const ageT = Math.max(0, 1 - (now - cur.t) / trailMs)
    const t = positionT * ageT
    const width = Math.max(0.6, 1.2 * Math.pow(t, 0.7) * 6 * s)
    const alpha = 0.8 * Math.pow(t, 0.85) * k
    if (alpha < 0.01) continue
    const beforePrev = i >= 2 ? trail[i - 2] : null
    ctx.lineWidth = width
    ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
    ctx.beginPath()
    if (beforePrev) {
      const midStart = {
        x: (beforePrev.x + prev.x) / 2,
        y: (beforePrev.y + prev.y) / 2
      }
      const midEnd = {
        x: (prev.x + cur.x) / 2,
        y: (prev.y + cur.y) / 2
      }
      ctx.moveTo(midStart.x, midStart.y)
      ctx.quadraticCurveTo(prev.x, prev.y, midEnd.x, midEnd.y)
    } else {
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(cur.x, cur.y)
    }
    ctx.stroke()
  }
  ctx.restore()
  drawCursorHead(ctx, head, rgb, k, s)
}

/**
 * Meteor tail: each particle is a soft radial blob, rendered with
 * additive blending so the overlapping blobs sum into a continuous
 * glow with no visible polyline. Particles drift slightly behind the
 * cursor + random jitter for an organic, splash-of-light feel.
 *
 * The size + alpha both fall with age, so older particles fade into
 * nothing rather than cutting off hard. The bright white core + outer
 * coloured halo on each particle reads like real radiative light.
 */
function drawMeteorTail(
  ctx: CanvasRenderingContext2D,
  particles: MeteorParticle[],
  rgb: { r: number; g: number; b: number },
  trailMs: number,
  intensity: number,
  size: number,
  now: number
): void {
  if (particles.length === 0) return
  ctx.save()
  // 'lighter' = additive RGB blending — perfect for emissive light.
  ctx.globalCompositeOperation = 'lighter'
  for (const p of particles) {
    const age = (now - p.birth) / trailMs
    if (age >= 1 || age < 0) continue
    // Apply drift since last frame so the tail "lags" behind the head.
    p.x += p.vx
    p.y += p.vy
    const life = 1 - age
    // ease-out so particles fade gracefully near the end of life.
    const ease = life * life
    const alpha = ease * 0.45 * intensity
    if (alpha < 0.008) continue
    // Particles slightly grow as they age (smoke-puff feel) before
    // disappearing — gives the trail volume without hard edges. The
    // user-controlled `size` multiplier scales the whole tail.
    const radius = p.size * (1 + age * 0.6) * size
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
    grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.85})`)
    grad.addColorStop(0.35, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`)
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawCursorHead(
  ctx: CanvasRenderingContext2D,
  head: CursorSample | Point,
  rgb: { r: number; g: number; b: number },
  intensity = 1,
  size = 1
): void {
  ctx.save()
  const k = Math.max(0, Math.min(1, intensity))
  const r = 14 * size
  const inner = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r)
  inner.addColorStop(0, `rgba(255,255,255,${0.9 * k})`)
  inner.addColorStop(0.4, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.8 * k})`)
  inner.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
  ctx.fillStyle = inner
  ctx.beginPath()
  ctx.arc(head.x, head.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Spotlight effect — dim the whole canvas with a soft-edged hole at
 * (cx, cy). The hole is built with a destination-out radial gradient so
 * the inner pixels are fully clear, the edge ones are partially clear,
 * giving a vignette transition instead of a hard circle.
 *
 * Radius scales with the user's stroke-width slider so the same control
 * the annotation tools use also picks the spotlight diameter.
 */
function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  canvasW: number,
  canvasH: number,
  strokeWidth: number
): void {
  // strokeWidth runs 1..16 from the toolbar slider. Map it to a 90..330
  // px outer radius so even the smallest setting is usable on 4K.
  const outer = 90 + Math.max(1, Math.min(16, strokeWidth)) * 15
  const inner = outer * 0.55 // sharp clear area inside, then soft fall-off

  // Bulletproof wash size: take the larger of the passed CSS size and
  // the real pixel-buffer size (back-converted to logical px). Earlier,
  // when window.innerWidth got out of sync with the canvas pixel buffer
  // (race between resize event and rAF, or a stale transform), the wash
  // only covered part of the screen — exactly the "rectangle gris
  // partiel" the user was reporting. With the max() this can't happen.
  const dpr = window.devicePixelRatio || 1
  const fullW = Math.max(canvasW, ctx.canvas.width / dpr)
  const fullH = Math.max(canvasH, ctx.canvas.height / dpr)

  // 1. Dark wash everywhere.
  ctx.save()
  ctx.fillStyle = 'rgba(7, 33, 47, 0.62)'
  ctx.fillRect(0, 0, fullW, fullH)

  // 2. Punch the spotlight hole. destination-out removes the canvas
  //    alpha where we draw; the radial gradient gives a soft edge.
  ctx.globalCompositeOperation = 'destination-out'
  const cut = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer)
  cut.addColorStop(0, 'rgba(0,0,0,1)')
  cut.addColorStop(0.7, 'rgba(0,0,0,0.6)')
  cut.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = cut
  ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2)
  ctx.restore()

  // 3. Thin coral ring on the outer edge of the bright zone so the
  //    user can see exactly what's in focus.
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 139, 123, 0.75)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, outer, 0, Math.PI * 2)
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
