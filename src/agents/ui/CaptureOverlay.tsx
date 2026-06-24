import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * CaptureOverlay — the region-selection surface (one per display).
 *
 * It is a TRANSPARENT always-on-top window: the user keeps seeing their
 * LIVE screen through a light wash, with just the selection toolbar + the
 * drag rectangle on top (no opaque "window over my content"). On confirm we
 * only send the chosen rectangle (device pixels) + the display id; the main
 * process hides this overlay and grabs the real screen, so the selection UI
 * is never in the shot.
 */

interface Frame {
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  mode: 'photo' | 'video'
  multiDisplay: boolean
  displayId: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function normalize(ax: number, ay: number, bx: number, by: number): Rect {
  const x = Math.min(ax, bx)
  const y = Math.min(ay, by)
  return { x, y, w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}

export function CaptureOverlay(): React.ReactElement {
  const [frame, setFrame] = useState<Frame | null>(null)
  const [mode, setMode] = useState<'photo' | 'video'>('photo')
  const [sel, setSel] = useState<Rect | null>(null)
  const [drawing, setDrawing] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const sentRef = useRef(false)

  useEffect(() => {
    let alive = true
    void window.api?.captureGetFrame().then((f) => {
      if (alive && f !== null) {
        setFrame(f as Frame)
        setMode((f as Frame).mode)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const cancel = useCallback(() => {
    if (sentRef.current) return
    sentRef.current = true
    window.api?.captureCancel()
  }, [])

  /** Send the chosen rect (device px) + display id. `r === null` = full. */
  const confirm = useCallback(
    (r: Rect | null) => {
      if (sentRef.current) return
      const cont = containerRef.current
      if (cont === null || frame === null) return
      const sf = frame.scaleFactor
      const rect: Rect =
        r ?? { x: 0, y: 0, w: cont.clientWidth, h: cont.clientHeight }
      const deviceRect = {
        x: Math.round(rect.x * sf),
        y: Math.round(rect.y * sf),
        width: Math.round(rect.w * sf),
        height: Math.round(rect.h * sf)
      }
      if (deviceRect.width < 1 || deviceRect.height < 1) return
      sentRef.current = true
      window.api?.captureRegionSelected({
        mode,
        displayId: frame.displayId,
        deviceRect
      })
    },
    [frame, mode]
  )

  // Global keys: Esc cancels, Enter captures the full display.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        confirm(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, confirm])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    startRef.current = { x: e.clientX, y: e.clientY }
    setSel({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
    setDrawing(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = startRef.current
    if (!drawing || s === null) return
    setSel(normalize(s.x, s.y, e.clientX, e.clientY))
  }
  const onPointerUp = () => {
    if (!drawing) return
    setDrawing(false)
    const r = sel
    startRef.current = null
    if (r !== null && r.w >= 4 && r.h >= 4) {
      confirm(r)
    } else {
      setSel(null)
    }
  }

  if (frame === null) {
    // Transparent placeholder while we fetch geometry — never opaque, so
    // the live screen is visible from the first frame.
    return <div style={{ width: '100%', height: '100%' }} />
  }

  const isVideo = mode === 'video'
  const accent = isVideo ? '#ff8b7b' : '#2BD9AC'
  const sf = frame.scaleFactor

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Light wash over the LIVE screen. The selection punches a clear
          hole so the chosen region shows at full brightness. */}
      {sel === null ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(6, 20, 17, 0.32)',
            pointerEvents: 'none'
          }}
        />
      ) : (
        <Dimmer rect={sel} />
      )}

      {/* Selection border + size badge */}
      {sel !== null && (
        <>
          <div
            style={{
              position: 'absolute',
              left: sel.x,
              top: sel.y,
              width: sel.w,
              height: sel.h,
              border: `2px solid ${accent}`,
              boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 0 18px ${accent}66`,
              pointerEvents: 'none'
            }}
          />
          {sel.w > 0 && sel.h > 0 && (
            <div
              style={{
                position: 'absolute',
                left: sel.x,
                top: Math.max(0, sel.y - 26),
                padding: '2px 8px',
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 600,
                color: '#06231D',
                background: accent,
                borderRadius: 6,
                pointerEvents: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              {Math.round(sel.w * sf)} × {Math.round(sel.h * sf)}
            </div>
          )}
        </>
      )}

      {/* Toolbar — only before the drag starts, centered top */}
      {sel === null && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            padding: '10px 18px',
            borderRadius: 999,
            background: 'rgba(10, 31, 27, 0.92)',
            color: '#E7F3ED',
            fontSize: 13,
            fontFamily: 'Syne, system-ui, sans-serif',
            border: `1px solid ${accent}55`,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            pointerEvents: 'auto'
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              gap: 2,
              padding: 2,
              borderRadius: 999,
              background: 'rgba(231,243,237,0.1)'
            }}
          >
            {(['photo', 'video'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  cursor: 'pointer',
                  border: 'none',
                  borderRadius: 999,
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: 'Syne, system-ui, sans-serif',
                  color: mode === m ? '#06231D' : '#E7F3ED',
                  background:
                    mode === m
                      ? m === 'video'
                        ? '#ff8b7b'
                        : '#2BD9AC'
                      : 'transparent'
                }}
              >
                {m === 'video' ? '🎥 Vidéo' : '📸 Photo'}
              </button>
            ))}
          </span>
          <span style={{ opacity: 0.85, pointerEvents: 'none' }}>
            Glisse pour sélectionner
          </span>
          <Kbd>Entrée</Kbd>
          <span style={{ opacity: 0.7, pointerEvents: 'none' }}>plein écran</span>
          <Kbd>Échap</Kbd>
          <span style={{ opacity: 0.7, pointerEvents: 'none' }}>annuler</span>
        </div>
      )}
    </div>
  )
}

/** Four wash rectangles around the selection (the bright "hole"). */
function Dimmer({ rect }: { rect: Rect }): React.ReactElement {
  const dim = 'rgba(6, 20, 17, 0.32)'
  const base: React.CSSProperties = {
    position: 'absolute',
    background: dim,
    pointerEvents: 'none'
  }
  return (
    <>
      <div style={{ ...base, left: 0, top: 0, right: 0, height: rect.y }} />
      <div
        style={{ ...base, left: 0, top: rect.y + rect.h, right: 0, bottom: 0 }}
      />
      <div
        style={{ ...base, left: 0, top: rect.y, width: rect.x, height: rect.h }}
      />
      <div
        style={{
          ...base,
          left: rect.x + rect.w,
          top: rect.y,
          right: 0,
          height: rect.h
        }}
      />
    </>
  )
}

function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 7px',
        borderRadius: 5,
        background: 'rgba(231,243,237,0.12)',
        border: '1px solid rgba(231,243,237,0.25)',
        color: '#E7F3ED'
      }}
    >
      {children}
    </kbd>
  )
}
