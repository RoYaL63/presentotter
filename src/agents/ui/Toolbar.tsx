import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Crosshair,
  Eraser,
  EyeOff,
  GripVertical,
  HelpCircle,
  Highlighter,
  Layout,
  Minus,
  MousePointer2,
  Palette,
  Pencil,
  Radar,
  RotateCcw,
  ShieldCheck,
  Square,
  Sun,
  Type,
  Undo2,
  X
} from 'lucide-react'
import { Mascot } from './components/Mascot'
import { SanitizerLiveEngine, type ScanResult } from './sanitizer-live'
import { useToolSettingsStore, type ToolId as SettingsToolId } from './stores/useToolSettingsStore'

const TOOLS = [
  { id: 'select', label: 'Sélection · passe-through', shortcut: 'Alt+S', Icon: MousePointer2 },
  { id: 'pencil', label: 'Crayon', shortcut: 'Alt+P', Icon: Pencil },
  { id: 'ephemeral', label: 'Surligneur éphémère (5 s)', shortcut: 'Alt+E', Icon: Highlighter },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'Alt+R', Icon: Square },
  { id: 'circle', label: 'Cercle', shortcut: 'Alt+O', Icon: Circle },
  { id: 'arrow', label: 'Flèche', shortcut: 'Alt+A', Icon: ArrowUpRight },
  { id: 'text', label: 'Texte', shortcut: 'Alt+T', Icon: Type },
  { id: 'spotlight', label: 'Spotlight', shortcut: 'Alt+L', Icon: Sun },
  { id: 'blur', label: 'Floute une zone (manuel)', shortcut: 'Alt+F', Icon: EyeOff }
] as const

type ToolId = (typeof TOOLS)[number]['id']

// Two rows of 7 — first row is the soft otter-morphism palette (good
// for elegant annotations during presentations), second row is the
// punchy "demo emphasis" set (high-saturation primaries + neutrals
// for max contrast on any background). Black and white sit at the end
// of row 2 so they're easy to find for monochrome work.
const COLORS: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#FF8B7B', label: 'Coral' },
  { hex: '#FFC857', label: 'Sunray' },
  { hex: '#4A7C59', label: 'Kelp' },
  { hex: '#B8E0E8', label: 'Aqua' },
  { hex: '#1B5E7B', label: 'Deep Sea' },
  { hex: '#C89E76', label: 'Caramel' },
  { hex: '#F5E6D3', label: 'Cream' },
  { hex: '#FF3B30', label: 'Rouge vif' },
  { hex: '#FF9500', label: 'Orange' },
  { hex: '#34C759', label: 'Vert vif' },
  { hex: '#007AFF', label: 'Bleu vif' },
  { hex: '#FF2D92', label: 'Rose fluo' },
  { hex: '#AF52DE', label: 'Violet' },
  { hex: '#FFFFFF', label: 'Blanc' }
]

export function Toolbar() {
  const [tool, setTool] = useState<ToolId>('select')
  const [color, setColor] = useState<string>('#FF8B7B')
  const [strokeWidth, setStrokeWidth] = useState<number>(4)
  const [opacity] = useState<number>(1)
  const [minimized, setMinimized] = useState(false)
  const [liveOn, setLiveOn] = useState(false)
  const [liveStatus, setLiveStatus] = useState<{
    count: number
    ms: number
    words: number
    preview: string
    at: number
  } | null>(null)
  const [livePhase, setLivePhase] = useState<'acquiring' | 'loading-ocr' | 'scanning' | 'idle' | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [cursorOn, setCursorOn] = useState(false)
  // Color picker pops out from the toolbar capsule. We resize the
  // host window so the popover never gets clipped by the bottom edge.
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  // Layout orientation: 'horizontal' is the historical floating
  // capsule, 'vertical' is a side-dock column the user can park
  // against the right edge of any display so the toolbar stops
  // blocking the screen content below it.
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>(() => {
    try {
      const stored = localStorage.getItem('po-toolbar-orientation')
      return stored === 'vertical' ? 'vertical' : 'horizontal'
    } catch {
      return 'horizontal'
    }
  })
  const apiRef = useRef<PresentOtterAPI | undefined>(window.api)
  const engineRef = useRef<SanitizerLiveEngine | null>(null)
  // Live masks need hysteresis: Tesseract OCR is non-deterministic and
  // a single scan can miss a token that the previous scan caught. We
  // keep each mask alive for STICKY_MASK_TTL_MS even if subsequent
  // scans don't see it; a fresh detection at the same spot refreshes
  // the TTL. Result: no flicker between scans.
  const stickyMasksRef = useRef<
    Array<LiveMask & { expiresAt: number }>
  >([])

  // Per-tool defaults persisted via Tools page (auto-synced across windows
  // through the storage event hooked inside useToolSettingsStore).
  const toolDefaults = useToolSettingsStore((s) => s.defaults)
  const cursorSettings = useToolSettingsStore((s) => s.cursor)
  const sanitizerSettings = useToolSettingsStore((s) => s.sanitizer)
  const ephemeralSettings = useToolSettingsStore((s) => s.ephemeral)
  const setStoredCursor = useToolSettingsStore((s) => s.setCursor)
  // Single source of truth for the cursor color: the persisted store.
  const cursorColor = cursorSettings.color

  /** Push the current tool selection to the overlay & toggle click-through.
   *  Also applies the per-tool defaults from the Tools page so users get
   *  their preferred color/stroke/opacity automatically.
   *
   *  Clicking the icon of the already-active tool deactivates it — the
   *  user goes back to 'select' (passe-through) without having to hunt
   *  for the Escape key. */
  const sendTool = useCallback(
    (next: ToolId) => {
      const target: ToolId = next === tool && next !== 'select' ? 'select' : next
      setTool(target)
      const api = apiRef.current
      if (!api) return
      // Apply persisted defaults if we have any for this tool
      if (target !== 'select') {
        const settingsId = target as SettingsToolId
        const def = toolDefaults[settingsId]
        if (def) {
          setColor(def.color)
          setStrokeWidth(def.strokeWidth)
          api.setColor(def.color)
          api.setStrokeWidth(def.strokeWidth)
          api.setOpacity(def.opacity)
        }
      }
      api.setTool(target)
      // Spotlight is a passive viewer aid — the user should still be
      // able to click the highlighted app underneath. So spotlight is
      // treated as 'select' for interactivity: overlay click-through,
      // no pointer capture. The spotlight visual still renders because
      // it reads from the global cursor poll, not from canvas events.
      const needsInteractive = target !== 'select' && target !== 'spotlight'
      api.setOverlayInteractive(needsInteractive)
      // Spotlight follows the cursor live → tell main to (a) flip the
      // poll on/off and (b) broadcast the active flag to overlays so
      // they know whether to paint the dark wash + clear circle.
      api.setSpotlightActive(target === 'spotlight')
    },
    [tool, toolDefaults]
  )

  const sendColor = useCallback((hex: string) => {
    setColor(hex)
    apiRef.current?.setColor(hex)
  }, [])

  /** Toggle the color popover and resize the toolbar window so the
   *  popover doesn't get clipped at the bottom edge. We grow to 180 px
   *  while open, snap back to 112 px on close. */
  const toggleColorPicker = useCallback(() => {
    setColorPickerOpen((open) => {
      const next = !open
      apiRef.current?.toolbarSetHeight(next ? 180 : 112)
      return next
    })
  }, [])

  const pickColor = useCallback(
    (hex: string) => {
      sendColor(hex)
      setColorPickerOpen(false)
      apiRef.current?.toolbarSetHeight(orientation === 'vertical' ? 700 : 112)
    },
    [sendColor, orientation]
  )

  /**
   * Toggle horizontal capsule ↔ vertical side-dock. The window is
   * resized AND repositioned in a single atomic IPC so we don't
   * flash the old shape at the wrong location.
   *
   * Vertical mode snaps to the right edge of the display the toolbar
   * is currently on; horizontal mode lands top-centre of the same
   * display. The clamp in main.ts is a backstop in case the chosen
   * coordinates would push the window off-screen on a small display.
   */
  const toggleOrientation = useCallback(async () => {
    const api = apiRef.current
    if (!api) return
    const next: 'horizontal' | 'vertical' =
      orientation === 'horizontal' ? 'vertical' : 'horizontal'
    setOrientation(next)
    try {
      localStorage.setItem('po-toolbar-orientation', next)
    } catch {
      // localStorage disabled — fine, the setting just won't persist.
    }
    // Close the color popover if open so its absolute position doesn't
    // sit in the old layout's coordinate space.
    setColorPickerOpen(false)
    const disp = await api.toolbarCurrentDisplayBounds()
    if (next === 'vertical') {
      const W = 88
      // 820 px gives enough room for every button at gap-1.5 + dividers
      // + py-7 padding. Below ~780 the bottom buttons (rotate, minimize,
      // close) get clipped, which is what made the previous build look
      // like the bar was "cut" and unrecoverable.
      const H = 820
      const x = disp ? disp.workArea.x + disp.workArea.width - W - 12 : 24
      const y = disp ? disp.workArea.y + Math.max(24, Math.floor((disp.workArea.height - H) / 2)) : 24
      api.toolbarSetBounds({ x, y, width: W, height: H })
    } else {
      const W = 1180
      const H = 112
      const x = disp ? disp.workArea.x + Math.floor((disp.workArea.width - W) / 2) : 24
      const y = disp ? disp.workArea.y + 24 : 24
      api.toolbarSetBounds({ x, y, width: W, height: H })
    }
  }, [orientation])

  const sendStroke = useCallback((w: number) => {
    setStrokeWidth(w)
    apiRef.current?.setStrokeWidth(w)
  }, [])

  // On mount: align overlay state with our default UI state
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.setColor(color)
    api.setStrokeWidth(strokeWidth)
    api.setOpacity(opacity)
    api.setTool(tool)
    api.setOverlayInteractive(tool !== 'select')
    // intentionally run once
  }, [])

  // Listen to global keyboard shortcuts (Alt+P, Alt+R, Escape, ...) so the
  // toolbar UI stays in sync when the user triggers tools without focus.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const off = api.onToolbarToolChanged((next) => {
      // Trust the main process — it only emits tool ids that exist
      // in our TOOLS list. The earlier `TOOLS.find(...)` narrowing
      // could silently swallow events if the strings ever drifted,
      // which is exactly what made Escape feel "broken": the state
      // stayed on the previous tool, the X icon kept showing, and
      // the user had to click multiple times to break out.
      setTool(next as ToolId)
    })
    return off
  }, [])

  // Triple-tap Alt fires from the main process via uiohook-napi and toggles
  // the cursor highlight. Mirror that state on the Crosshair button so the
  // user sees the active indicator without re-clicking.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const off = api.onCursorHighlightChanged((enabled) => setCursorOn(enabled))
    return off
  }, [])

  const handleClear = () => apiRef.current?.clearOverlay()
  const handleUndo = () => apiRef.current?.undoOverlay()
  const handleConsole = () => apiRef.current?.openConsole()
  const handleClose = () => apiRef.current?.toolbarClose()

  const handleScanResult = useCallback((result: ScanResult) => {
    const now = Date.now()
    // 15 s sticky TTL (was 6 s). At 1 s scan cadence that's 15 chances
    // to re-detect the same secret before its mask expires, so a streak
    // of OCR misses no longer causes a visible flicker.
    const STICKY_MASK_TTL_MS = 15000
    // Match a fresh mask against a sticky one via bbox overlap. Since
    // masks are now horizontal stripes (full row to the right edge),
    // two masks on the same row will overlap massively and merge into
    // a single refresh, regardless of label. We deliberately drop the
    // strict label-equality check: OCR sometimes misreads characters
    // around the secret, which flips a regex hit to a contextual hit
    // and back, causing flicker. The position is what matters.
    const MIN_OVERLAP_RATIO = 0.3
    const overlapRatio = (a: LiveMask, b: LiveMask): number => {
      const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
      const inter = ix * iy
      if (inter === 0) return 0
      const aArea = a.width * a.height
      const bArea = b.width * b.height
      const minArea = Math.min(aArea, bArea)
      return minArea > 0 ? inter / minArea : 0
    }
    const sameRegion = (
      a: LiveMask,
      b: LiveMask & { expiresAt: number }
    ): boolean => overlapRatio(a, b) >= MIN_OVERLAP_RATIO

    const refreshedExpiry = now + STICKY_MASK_TTL_MS
    const newSticky: Array<LiveMask & { expiresAt: number }> = []
    // 1. Carry over previous masks that still have TTL left and are
    //    NOT already represented in the fresh batch (we'll re-add
    //    those next with refreshed positions).
    for (const old of stickyMasksRef.current) {
      if (old.expiresAt <= now) continue
      const matched = result.masks.some((m) => sameRegion(m, old))
      if (matched) continue // will be added by the fresh-mask loop below
      newSticky.push(old)
    }
    // 2. Add (or refresh) every mask from the fresh scan.
    for (const m of result.masks) {
      newSticky.push({ ...m, expiresAt: refreshedExpiry })
    }
    stickyMasksRef.current = newSticky

    // Status reflects what the LATEST scan actually saw, not the
    // sticky carryover — useful to spot when OCR loses a region.
    setLiveStatus({
      count: result.masks.length,
      ms: result.scanDurationMs,
      words: result.wordCount,
      preview: result.preview,
      at: now
    })
    setLiveError(null)
    // Send the merged list (fresh + sticky) to the overlays so the
    // user sees a stable masking even when individual scans wobble.
    apiRef.current?.setLiveMasks(newSticky)
    apiRef.current?.setLiveOcrWords(result.ocrWords)
  }, [])

  // Periodically prune expired sticky masks even if no new scan came
  // in (e.g., user stopped looking at a page that had a secret on it).
  useEffect(() => {
    if (!liveOn) return
    const id = window.setInterval(() => {
      const now = Date.now()
      const before = stickyMasksRef.current.length
      const next = stickyMasksRef.current.filter((m) => m.expiresAt > now)
      if (next.length !== before) {
        stickyMasksRef.current = next
        apiRef.current?.setLiveMasks(next)
      }
    }, 800)
    return () => window.clearInterval(id)
  }, [liveOn])

  // Push contextual flag changes to the running engine without restart.
  useEffect(() => {
    engineRef.current?.setContextual(sanitizerSettings.contextual)
  }, [sanitizerSettings.contextual])

  // Push ephemeral lifetime to overlays whenever the user adjusts it
  // from Tools. Strokes already in flight keep the lifeMs they were
  // born with — only the NEXT stroke uses the new value.
  useEffect(() => {
    apiRef.current?.setEphemeralLifeMs(ephemeralSettings.lifeMs)
  }, [ephemeralSettings.lifeMs])

  const handleToggleLive = useCallback(async () => {
    const api = apiRef.current
    if (!api) return
    if (liveOn) {
      // Stop
      setLiveOn(false)
      setLiveStatus(null)
      setLivePhase(null)
      // Empty the sticky pool — otherwise stopping and restarting
      // LIVE in the same session would carry over stale masks.
      stickyMasksRef.current = []
      api.clearLiveMasks()
      api.clearLiveOcrWords()
      if (engineRef.current) {
        await engineRef.current.stop()
        engineRef.current = null
      }
      return
    }
    // Start
    try {
      setLiveError(null)
      setLiveOn(true)
      setLivePhase('acquiring')
      const engine = new SanitizerLiveEngine()
      engine.setContextual(sanitizerSettings.contextual)
      engineRef.current = engine
      // Let the engine use its DEFAULT_INTERVAL_MS (250 ms in v0.5.12+):
      // the hash-skip path means most ticks bail out in ~3 ms, and the
      // 4× faster tick rate cuts the worst-case "secret visible" window
      // by ~750 ms vs the old 1 s cadence.
      await engine.start(undefined, handleScanResult, (phase) => setLivePhase(phase))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[toolbar] live sanitizer failed to start:', err)
      setLiveError(message)
      setLiveOn(false)
      setLivePhase(null)
      if (engineRef.current) {
        void engineRef.current.stop()
        engineRef.current = null
      }
    }
  }, [liveOn, handleScanResult, sanitizerSettings.contextual])

  // Tear down the engine when the toolbar unmounts (app quit)
  useEffect(() => {
    return () => {
      if (engineRef.current !== null) {
        void engineRef.current.stop()
        engineRef.current = null
      }
    }
  }, [])

  const handleToggleCursor = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    const next = !cursorOn
    setCursorOn(next)
    api.setCursorHighlight(next)
  }, [cursorOn])

  // Forward the full cursor settings bundle to overlays whenever any field
  // changes — at mount, when the Tools page edits a slider, or when another
  // window's storage event syncs us. One effect, one source of truth.
  useEffect(() => {
    apiRef.current?.setCursorSettings({
      color: cursorSettings.color,
      style: cursorSettings.style,
      trailLengthMs: cursorSettings.trailLengthMs,
      intensity: cursorSettings.intensity,
      size: cursorSettings.size
    })
  }, [
    cursorSettings.color,
    cursorSettings.style,
    cursorSettings.trailLengthMs,
    cursorSettings.intensity,
    cursorSettings.size
  ])

  /** Color picker in the toolbar updates the shared store; the storage event
   *  propagates the change to Home (Tools page) and the overlay listens to
   *  the cursor settings IPC fired by the effect above. */
  const handleCursorColor = useCallback(
    (hex: string) => {
      setStoredCursor({ color: hex })
    },
    [setStoredCursor]
  )

  const handleMinimize = () => {
    setMinimized(true)
    apiRef.current?.toolbarMinimize()
  }
  /**
   * Restore the toolbar to its full shape — and crucially, to the
   * shape matching the CURRENT orientation. The legacy `toolbarRestore`
   * IPC always hard-coded the horizontal dimensions, so coming back
   * from the minimized bubble while orientation was 'vertical' would
   * leave the window at 1180×112 with vertical layout inside — narrow
   * column rendered into a wide capsule. We send set-bounds with the
   * orientation-aware size + the bubble's current position so the
   * shape lands where the user expects.
   */
  const handleRestore = () => {
    setMinimized(false)
    const x = window.screenX
    const y = window.screenY
    if (orientation === 'vertical') {
      apiRef.current?.toolbarSetBounds({ x, y, width: 88, height: 820 })
    } else {
      apiRef.current?.toolbarRestore()
    }
  }

  if (minimized) {
    return <MinimizedBubble onRestore={handleRestore} api={apiRef.current} />
  }

  const isVertical = orientation === 'vertical'
  // Layout swaps: when vertical, the wrapper centres the capsule in the
  // narrow window, the capsule itself stacks its content with flex-col,
  // and dividers rotate from a vertical line to a horizontal bar.
  const wrapperCls = isVertical
    ? 'flex h-screen w-screen items-start justify-center px-2 py-3'
    : 'flex h-screen w-screen items-center justify-center px-3 py-2'
  // Vertical: tighter padding + overflow-y-auto as a safety net for
  // small screens where the full content can't fit. The user can still
  // scroll to reach a button if their screen is too short to show
  // everything. Horizontal keeps its original spacing.
  const capsuleCls = isVertical
    ? 'glass glass-shine flex flex-col items-center gap-1 py-3 px-2.5 animate-fade-in-up max-h-full overflow-y-auto'
    : 'glass glass-shine flex items-center gap-1.5 px-7 py-2.5 animate-fade-in-up'
  const dividerCls = isVertical ? 'w-7 h-px bg-white/[0.08]' : 'h-7 w-px bg-white/[0.08]'
  const dividerInlineCls = isVertical
    ? 'my-1 w-7 h-px bg-white/[0.08]'
    : 'mx-1 h-7 w-px bg-white/[0.08]'
  // Groups of buttons (tools, actions, cursor area) need to stack in
  // vertical mode just like the parent capsule.
  const groupCls = isVertical
    ? 'flex flex-col items-center gap-1'
    : 'flex items-center gap-1'

  return (
    <div
      className={wrapperCls}
      style={
        {
          background: 'transparent',
          // Drag from ANY edge of the toolbar window, not just the
          // grip handle or the centre of the glass capsule. The
          // transparent margin around the capsule (the part of the
          // toolbar window that's invisible) becomes draggable too,
          // so the user can grab whichever edge is closest to their
          // cursor. Individual buttons inside the capsule still opt
          // out via `no-drag` so they remain clickable.
          WebkitAppRegion: 'drag'
        } as React.CSSProperties
      }
    >
      <div
        className={capsuleCls}
        style={
          {
            // Allow the user to drag the whole toolbar by default;
            // specific controls opt out via `no-drag` below.
            WebkitAppRegion: 'drag',
            // Explicit pixel radius rather than 9999 — the clamp value
            // is more deterministic across DPI scales, so the curves
            // always render the same way and never get cropped at the
            // window's hard edge.
            borderRadius: 36,
            boxShadow:
              '0 6px 18px rgba(7, 33, 47, 0.32), 0 2px 6px rgba(7, 33, 47, 0.22), inset 0 1px 0 rgba(184, 224, 232, 0.18)'
          } as React.CSSProperties
        }
      >
        {/* Drag handle (visual cue) */}
        <div
          className="flex h-8 w-4 items-center justify-center text-otter-200/40 cursor-grab active:cursor-grabbing"
          title="Glisser pour déplacer"
          aria-hidden
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
        </div>

        {/* Logo — static loutre, click to bring Home forward. No clay
            background or float animation; the icon stays still in the
            toolbar so the eye anchors to it. */}
        <button
          type="button"
          onClick={handleConsole}
          title="Rouvrir PresentOtter"
          aria-label="Rouvrir PresentOtter"
          className="mr-0.5 flex h-8 w-8 items-center justify-center transition-transform duration-150 hover:scale-110 active:scale-95"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Mascot size={30} />
        </button>

        {/* Orientation toggle — placed at the TOP so even if the vertical
            bar gets visually truncated on a short screen, the user can
            always reach the button to switch back to horizontal. */}
        <button
          type="button"
          onClick={() => void toggleOrientation()}
          title={
            isVertical
              ? 'Repasser en barre horizontale (haut d\'écran)'
              : 'Passer en colonne verticale (bord droit d\'écran)'
          }
          aria-label="Changer l'orientation de la toolbar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <RotateCcw className="h-4 w-4" strokeWidth={2} />
        </button>

        <div className={dividerCls} aria-hidden />

        {/* Tools */}
        <div
          className={groupCls}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {TOOLS.map(({ id, label, shortcut, Icon }) => {
            // 'select' is the neutral resting state ("no tool / passe-
            // through"), so it NEVER shows as active and never gets the
            // X exit affordance. Pressing Escape returns to select →
            // no button highlights → no stray cross, which is what the
            // user expects ("plus le logo croix puisqu'il n'est plus
            // sélectionné"). Only real drawing tools light up coral
            // and swap their icon to ✕ to advertise "click to exit".
            const active = tool === id && id !== 'select'
            const DisplayIcon = active ? X : Icon
            const buttonTitle = active
              ? `Quitter ${label.toLowerCase()} · ${shortcut}`
              : `${label} — ${shortcut}`
            const buttonAria = active
              ? `Quitter ${label.toLowerCase()}`
              : `${label} (${shortcut})`
            return (
              <button
                key={id}
                type="button"
                onClick={() => sendTool(id)}
                aria-pressed={active}
                aria-label={buttonAria}
                title={buttonTitle}
                className={`relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 otter-aqua ${
                  active
                    ? 'bg-gradient-to-br from-coral-400 to-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/50'
                    : 'text-sea-200/85 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/30 to-transparent pointer-events-none"
                    aria-hidden
                  />
                )}
                <DisplayIcon className="relative h-4 w-4" strokeWidth={2} />
              </button>
            )
          })}
        </div>

        <div className={dividerCls} aria-hidden />

        {/* Color button — single swatch + chevron-style ring that
            opens a popover with the full palette. Big space saver vs
            7 swatches inline. */}
        <div
          className="relative flex items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={toggleColorPicker}
            aria-expanded={colorPickerOpen}
            aria-label="Choisir une couleur"
            title="Couleur du trait"
            className={`relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 ${
              colorPickerOpen
                ? 'bg-white/[0.10] ring-1 ring-white/30'
                : 'hover:bg-white/[0.06]'
            }`}
          >
            <span
              className="absolute inset-1.5 rounded-md ring-1 ring-white/40 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25)]"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <Palette
              className="relative h-3 w-3 text-white/90 mix-blend-overlay"
              strokeWidth={2.4}
              aria-hidden
            />
          </button>

          {colorPickerOpen && (
            <div
              role="dialog"
              aria-label="Palette de couleurs"
              className={
                isVertical
                  ? 'glass glass-shine absolute right-full top-1/2 z-50 mr-3 grid -translate-y-1/2 grid-cols-2 gap-1.5 rounded-2xl px-2 py-2 shadow-glass animate-fade-in-up'
                  : 'glass glass-shine absolute top-full left-1/2 z-50 mt-3 grid -translate-x-1/2 grid-cols-7 gap-1.5 rounded-2xl px-2 py-2 shadow-glass animate-fade-in-up'
              }
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {COLORS.map(({ hex, label }) => {
                const active = color === hex
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => pickColor(hex)}
                    aria-label={`Couleur ${label}`}
                    title={label}
                    className={`relative h-6 w-6 rounded-full transition-all duration-150 ${
                      active
                        ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-deep-900 scale-110'
                        : 'ring-1 ring-white/30 hover:scale-110'
                    }`}
                    style={{ backgroundColor: hex }}
                  >
                    {active && (
                      <Check
                        className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow"
                        strokeWidth={3}
                        aria-hidden
                      />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Stroke slider is hidden in vertical mode — it needs ~80 px of
            horizontal real estate which doesn't fit the 88 px-wide
            side-dock. The value remains adjustable from Home → Tools. */}
        {!isVertical && (
          <>
            <div className={dividerCls} aria-hidden />
            <div
              className="flex items-center gap-2 px-1"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <label className="flex items-center gap-1.5" title="Épaisseur du trait">
                <span className="text-[10px] uppercase tracking-wider text-otter-200/60">px</span>
                <input
                  type="range"
                  min={1}
                  max={16}
                  step={1}
                  value={strokeWidth}
                  onChange={(e) => sendStroke(Number(e.target.value))}
                  aria-label="Épaisseur"
                  className="h-1 w-14 cursor-pointer accent-otter-400"
                />
                <span className="w-4 text-right text-[10px] font-medium text-otter-300 tabular-nums">
                  {strokeWidth}
                </span>
              </label>
            </div>
          </>
        )}

        <div className={dividerCls} aria-hidden />

        {/* Action buttons (undo, clear, console, minimize, close) */}
        <div
          className={groupCls}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={handleUndo}
            title="Annuler le dernier trait — Alt+Z"
            aria-label="Annuler"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
          >
            <Undo2 className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleClear}
            title="Tout effacer — Alt+Shift+C"
            aria-label="Tout effacer"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-otter-200/80 transition-all hover:bg-red-500/15 hover:text-red-200"
          >
            <Eraser className="h-4 w-4" strokeWidth={2} />
          </button>

          <div className={dividerInlineCls} aria-hidden />

          {/* LIVE Sanitizer toggle — scans the screen with OCR and masks secrets
              on the overlay in real time. Visible to anyone watching your
              screen share. */}
          <button
            type="button"
            onClick={handleToggleLive}
            aria-pressed={liveOn}
            title={
              liveOn
                ? `Sanitizer LIVE actif · masque en direct${liveStatus ? ` · ${liveStatus.count} zone(s) en ${liveStatus.ms}ms` : ''}`
                : 'Activer le Sanitizer LIVE · scan continu de l\'écran'
            }
            aria-label="Sanitizer LIVE"
            className={`relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 otter-aqua ${
              liveOn
                ? 'bg-gradient-to-br from-coral-400 to-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/50'
                : 'text-sea-200 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <Radar className={`relative h-4 w-4 ${liveOn ? 'animate-pulse' : ''}`} strokeWidth={2} />
            {liveOn && liveStatus !== null && liveStatus.count > 0 && (
              <span
                className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral-500 px-1 text-[9px] font-bold text-white tabular-nums shadow-glow-coral"
                aria-label={`${liveStatus.count} secret(s) détecté(s)`}
              >
                {liveStatus.count}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => apiRef.current?.openSanitizer()}
            title="Coller un texte pour vérifier qu'il ne contient pas de secret. S'ouvre dans la fenêtre principale."
            aria-label="Ouvrir le sanitizer manuel"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-300 transition-all hover:bg-otter-500/15 hover:text-otter-200"
          >
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          </button>

          <div
            className={
              isVertical
                ? 'relative flex flex-col items-center'
                : 'relative flex items-center'
            }
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={handleToggleCursor}
              aria-pressed={cursorOn}
              title={
                cursorOn
                  ? 'Curseur en évidence actif · halo + traînée colorée · triple-tap Alt pour couper'
                  : 'Mettre le curseur en évidence (halo + traînée) · triple-tap Alt'
              }
              aria-label="Cursor highlight"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
                cursorOn
                  ? 'text-white shadow-glow-otter ring-1 ring-white/30'
                  : 'text-otter-200/80 hover:bg-white/[0.06] hover:text-otter-50'
              }`}
              style={
                cursorOn
                  ? {
                      background: `linear-gradient(135deg, ${cursorColor}, ${cursorColor}cc)`
                    }
                  : undefined
              }
            >
              <Crosshair className="h-4 w-4" strokeWidth={2} />
            </button>
            <label
              className={
                isVertical
                  ? 'mt-0.5 inline-flex h-8 w-5 items-center justify-center rounded-md cursor-pointer hover:bg-white/[0.05]'
                  : 'ml-0.5 inline-flex h-8 w-5 items-center justify-center rounded-md cursor-pointer hover:bg-white/[0.05]'
              }
              title="Couleur du curseur"
            >
              <span
                className="h-3 w-3 rounded-full ring-1 ring-white/40"
                style={{ backgroundColor: cursorColor }}
                aria-hidden
              />
              <input
                type="color"
                value={cursorColor}
                onChange={(e) => handleCursorColor(e.target.value)}
                aria-label="Couleur du curseur"
                className="sr-only"
              />
            </label>
            {/* Cursor size — hidden in vertical mode for the same
                reason as the stroke slider. Still tweakable from
                Home → Tools. */}
            {!isVertical && (
              <label
                className="ml-1 inline-flex h-8 items-center gap-1 rounded-md px-1 hover:bg-white/[0.05]"
                title="Taille du curseur"
              >
                <span className="text-[9px] uppercase tracking-wider text-otter-200/55">
                  ×
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={cursorSettings.size}
                  onChange={(e) =>
                    setStoredCursor({ size: Number(e.target.value) })
                  }
                  aria-label="Taille du curseur"
                  className="h-1 w-12 cursor-pointer accent-coral-400"
                />
                <span className="w-5 text-right text-[9px] font-medium text-otter-200/70 tabular-nums">
                  {cursorSettings.size.toFixed(1)}
                </span>
              </label>
            )}
          </div>

          {/* Help + console buttons are hidden in vertical mode because
              clicking the mascot already brings the Home window forward
              (where shortcuts + console live). Saves ~64 px in the
              column for the buttons that actually matter (rotate,
              minimize, close). */}
          {!isVertical && (
            <>
              <button
                type="button"
                onClick={() => apiRef.current?.openShortcuts()}
                title="Tous les raccourcis clavier — s'ouvre dans la fenêtre principale"
                aria-label="Aide raccourcis"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
              >
                <HelpCircle className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={handleConsole}
                title="Ouvrir la console · bibliothèque, paramètres"
                aria-label="Ouvrir la console"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
              >
                <Layout className="h-4 w-4" strokeWidth={2} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleMinimize}
            title="Réduire en bulle · Alt+B masque la toolbar"
            aria-label="Réduire"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
          >
            <Minus className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="Quitter"
            aria-label="Quitter"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-200/80 transition-all hover:bg-red-500/20 hover:text-red-200"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Opacity is wired up but kept off the visible toolbar for now */}
      <div className="sr-only" aria-hidden>
        Opacité: {opacity}
      </div>

      {liveOn && (
        <div
          role="status"
          className="pointer-events-auto absolute top-full left-1/2 mt-2 -translate-x-1/2 flex max-w-[700px] items-center gap-2.5 rounded-2xl glass px-4 py-2 text-[11px] text-otter-100 shadow-glass animate-fade-in-up"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className="relative inline-flex h-2 w-2 flex-shrink-0">
            <span
              className="absolute inset-0 rounded-full bg-coral-400 animate-glow-pulse"
              aria-hidden
            />
            <span className="relative h-2 w-2 rounded-full bg-coral-500" aria-hidden />
          </span>
          <span className="font-semibold tracking-wide whitespace-nowrap">
            {livePhase === 'acquiring' && 'Acquisition de l\'écran…'}
            {livePhase === 'loading-ocr' && 'Chargement OCR (Tesseract)…'}
            {livePhase === 'scanning' && liveStatus === null && 'Analyse en cours…'}
            {liveStatus !== null && (
              liveStatus.count === 0
                ? `0 secret · ${liveStatus.words} mots · ${liveStatus.ms}ms`
                : `${liveStatus.count} masqué${liveStatus.count > 1 ? 's' : ''} · ${liveStatus.words} mots · ${liveStatus.ms}ms`
            )}
            {livePhase === null && liveStatus === null && 'Sanitizer LIVE actif'}
          </span>
          {liveStatus !== null && liveStatus.preview.length > 0 && (
            <span
              className="hidden sm:inline truncate text-otter-100/65 font-mono text-[10px]"
              title={liveStatus.preview}
            >
              · &ldquo;{liveStatus.preview}&rdquo;
            </span>
          )}
        </div>
      )}

      {liveError !== null && (
        <div
          role="alert"
          className="pointer-events-auto absolute top-24 left-1/2 -translate-x-1/2 rounded-xl border border-red-400/40 bg-red-950/80 backdrop-blur-xl px-4 py-2 text-xs text-red-100 shadow-glass animate-fade-in-up"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <strong className="font-semibold">Sanitizer LIVE indisponible :</strong> {liveError}
          <button
            type="button"
            onClick={() => setLiveError(null)}
            className="ml-3 text-red-200/70 hover:text-red-100"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Minimized state of the toolbar — a 56×56 bubble showing the mascot.
 *
 * Mouse contract:
 *   - Press, release without moving more than DRAG_THRESHOLD_PX
 *       → treated as click → restore the full toolbar.
 *   - Press, drag, release
 *       → moves the toolbar window via IPC (toolbar:set-position) so
 *         the user can park the bubble anywhere on screen.
 *
 * We can't use the native -webkit-app-region: drag trick because we
 * also need a click handler — a draggable region swallows pointer
 * events. So we drive the window position manually from pointer events
 * and rely on the move-vs-click distance to decide intent on release.
 */
interface MinimizedBubbleProps {
  onRestore(): void
  api: PresentOtterAPI | undefined
}

function MinimizedBubble({ onRestore, api }: MinimizedBubbleProps): React.ReactElement {
  // Track the pointer-down state so we can:
  //   1. Compute window deltas during move
  //   2. Decide click vs drag on release (distance threshold)
  const dragState = useRef<{
    pointerId: number
    // Pointer position at press, in SCREEN coords. We compute screen
    // coords as window.screenX + clientX so we can later translate the
    // pointer's current screen position into a new window origin.
    startScreenX: number
    startScreenY: number
    // Window origin at press — what we'll add the cursor delta to.
    startWinX: number
    startWinY: number
    moved: boolean
  } | null>(null)

  const DRAG_THRESHOLD_PX = 4

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = {
      pointerId: e.pointerId,
      startScreenX: window.screenX + e.clientX,
      startScreenY: window.screenY + e.clientY,
      startWinX: window.screenX,
      startWinY: window.screenY,
      moved: false
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragState.current
    if (s === null || e.pointerId !== s.pointerId) return
    const curScreenX = window.screenX + e.clientX
    const curScreenY = window.screenY + e.clientY
    const dx = curScreenX - s.startScreenX
    const dy = curScreenY - s.startScreenY
    if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    s.moved = true
    api?.toolbarSetPosition(s.startWinX + dx, s.startWinY + dy)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragState.current
    dragState.current = null
    if (s === null || e.pointerId !== s.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released (Windows quirk on cross-window drags)
    }
    if (!s.moved) onRestore()
  }

  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'transparent' }}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragState.current = null
        }}
        aria-label="Déployer la toolbar (clic) ou déplacer (glisser)"
        title="Clic pour déployer · glisser pour déplacer"
        className="otter-clay otter-aqua animate-fade-in-up flex h-14 w-14 items-center justify-center overflow-hidden transition-transform duration-200 hover:scale-110 active:scale-95 cursor-grab active:cursor-grabbing"
        style={{ borderRadius: 999 }}
      >
        <Mascot size={42} />
      </button>
    </div>
  )
}
