import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Crosshair,
  Eraser,
  GripVertical,
  Info,
  Layout,
  Minus,
  MousePointer2,
  Pencil,
  Radar,
  ShieldCheck,
  Square,
  Sun,
  Type,
  Undo2,
  X
} from 'lucide-react'
import { SanitizerPopup } from './SanitizerPopup'
import { SanitizerLiveEngine, type ScanResult } from './sanitizer-live'

const TOOLS = [
  { id: 'select', label: 'Sélection · passe-through', shortcut: 'Alt+S', Icon: MousePointer2 },
  { id: 'pencil', label: 'Crayon', shortcut: 'Alt+P', Icon: Pencil },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'Alt+R', Icon: Square },
  { id: 'circle', label: 'Cercle', shortcut: 'Alt+O', Icon: Circle },
  { id: 'arrow', label: 'Flèche', shortcut: 'Alt+A', Icon: ArrowUpRight },
  { id: 'text', label: 'Texte', shortcut: 'Alt+T', Icon: Type },
  { id: 'spotlight', label: 'Spotlight', shortcut: 'Alt+L', Icon: Sun }
] as const

type ToolId = (typeof TOOLS)[number]['id']

const COLORS: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#ef4444', label: 'Rouge' },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#eab308', label: 'Jaune' },
  { hex: '#22d3ee', label: 'Cyan' },
  { hex: '#3b82f6', label: 'Bleu' },
  { hex: '#a855f7', label: 'Violet' },
  { hex: '#ffffff', label: 'Blanc' }
]

export function Toolbar() {
  const [tool, setTool] = useState<ToolId>('select')
  const [color, setColor] = useState<string>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState<number>(4)
  const [opacity] = useState<number>(1)
  const [minimized, setMinimized] = useState(false)
  const [sanitizerOpen, setSanitizerOpen] = useState(false)
  const [liveOn, setLiveOn] = useState(false)
  const [liveStatus, setLiveStatus] = useState<{ count: number; ms: number } | null>(null)
  const [livePhase, setLivePhase] = useState<'acquiring' | 'loading-ocr' | 'scanning' | 'idle' | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [cursorOn, setCursorOn] = useState(false)
  const [cursorColor, setCursorColor] = useState<string>(() => {
    try {
      return localStorage.getItem('presentotter:cursor-color') ?? '#22d3ee'
    } catch {
      return '#22d3ee'
    }
  })
  const [showShareHint, setShowShareHint] = useState(true)
  const apiRef = useRef<PresentOtterAPI | undefined>(window.api)
  const engineRef = useRef<SanitizerLiveEngine | null>(null)

  /** Push the current tool selection to the overlay & toggle click-through. */
  const sendTool = useCallback((next: ToolId) => {
    setTool(next)
    const api = apiRef.current
    if (!api) return
    api.setTool(next)
    api.setOverlayInteractive(next !== 'select')
  }, [])

  const sendColor = useCallback((hex: string) => {
    setColor(hex)
    apiRef.current?.setColor(hex)
  }, [])

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
      // Narrow the IPC payload to our local ToolId set
      const known = TOOLS.find((t) => t.id === next)
      if (known) setTool(known.id)
    })
    return off
  }, [])

  const handleClear = () => apiRef.current?.clearOverlay()
  const handleUndo = () => apiRef.current?.undoOverlay()
  const handleConsole = () => apiRef.current?.openConsole()
  const handleClose = () => apiRef.current?.toolbarClose()

  const handleScanResult = useCallback((result: ScanResult) => {
    setLiveStatus({ count: result.masks.length, ms: result.scanDurationMs })
    setLiveError(null)
    apiRef.current?.setLiveMasks(result.masks)
  }, [])

  const handleToggleLive = useCallback(async () => {
    const api = apiRef.current
    if (!api) return
    if (liveOn) {
      // Stop
      setLiveOn(false)
      setLiveStatus(null)
      setLivePhase(null)
      api.clearLiveMasks()
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
      engineRef.current = engine
      await engine.start(2000, handleScanResult, (phase) => setLivePhase(phase))
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
  }, [liveOn, handleScanResult])

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

  // Push the persisted cursor color to overlays as soon as the toolbar mounts
  // (so the very first time the user enables the highlight it uses the right hue).
  useEffect(() => {
    apiRef.current?.setCursorColor(cursorColor)
  }, [cursorColor])

  const handleCursorColor = useCallback((hex: string) => {
    setCursorColor(hex)
    try {
      localStorage.setItem('presentotter:cursor-color', hex)
    } catch {
      // ignore quota / unavailable
    }
    apiRef.current?.setCursorColor(hex)
  }, [])

  const handleMinimize = () => {
    setMinimized(true)
    apiRef.current?.toolbarMinimize()
  }
  const handleRestore = () => {
    setMinimized(false)
    apiRef.current?.toolbarRestore()
  }

  if (minimized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: 'transparent' }}>
        <button
          type="button"
          onClick={handleRestore}
          aria-label="Déployer la toolbar"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-otter-400 to-otter-600 text-2xl shadow-glow-otter-lg ring-1 ring-white/30 animate-fade-in-up transition-transform duration-200 hover:scale-110 active:scale-95"
        >
          🦦
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex h-screen w-screen items-center justify-center px-3 py-2"
      style={{ background: 'transparent' }}
    >
      <div
        className="glass glass-shine flex items-center gap-1.5 rounded-2xl px-3 py-2 shadow-glass-lg animate-fade-in-up"
        style={
          {
            // Allow the user to drag the whole toolbar by default; specific
            // controls opt out via `no-drag` below.
            WebkitAppRegion: 'drag'
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

        {/* Logo */}
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-otter-400 to-otter-600 text-base shadow-glow-otter ring-1 ring-otter-300/40 mr-0.5" aria-hidden>
          🦦
        </div>

        <div className="h-7 w-px bg-white/[0.08]" aria-hidden />

        {/* Tools */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {TOOLS.map(({ id, label, shortcut, Icon }) => {
            const active = tool === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => sendTool(id)}
                aria-pressed={active}
                aria-label={`${label} (${shortcut})`}
                title={`${label} — ${shortcut}`}
                className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
                  active
                    ? 'bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter ring-1 ring-otter-300/40'
                    : 'text-otter-200/80 hover:bg-white/[0.06] hover:text-otter-50'
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/30 to-transparent pointer-events-none"
                    aria-hidden
                  />
                )}
                <Icon className="relative h-4 w-4" strokeWidth={2} />
              </button>
            )
          })}
        </div>

        <div className="h-7 w-px bg-white/[0.08]" aria-hidden />

        {/* Color swatches */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {COLORS.map(({ hex, label }) => {
            const active = color === hex
            return (
              <button
                key={hex}
                type="button"
                onClick={() => sendColor(hex)}
                aria-label={`Couleur ${label}`}
                title={label}
                className={`relative h-5 w-5 rounded-full transition-all duration-200 ${
                  active
                    ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-deep-900 scale-110'
                    : 'ring-1 ring-white/30 hover:scale-105'
                }`}
                style={{ backgroundColor: hex }}
              />
            )
          })}
        </div>

        <div className="h-7 w-px bg-white/[0.08]" aria-hidden />

        {/* Stroke + opacity sliders */}
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

        <div className="h-7 w-px bg-white/[0.08]" aria-hidden />

        {/* Action buttons (undo, clear, console, minimize, close) */}
        <div
          className="flex items-center gap-1"
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

          <div className="mx-1 h-7 w-px bg-white/[0.08]" aria-hidden />

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
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
              liveOn
                ? 'bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter ring-1 ring-otter-300/40'
                : 'text-otter-300 hover:bg-otter-500/15 hover:text-otter-200'
            }`}
          >
            <Radar className={`relative h-4 w-4 ${liveOn ? 'animate-pulse' : ''}`} strokeWidth={2} />
            {liveOn && liveStatus !== null && liveStatus.count > 0 && (
              <span
                className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white tabular-nums shadow-glow-red"
                aria-label={`${liveStatus.count} secret(s) détecté(s)`}
              >
                {liveStatus.count}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSanitizerOpen(true)}
            title="Sanitizer · vérifier un texte collé"
            aria-label="Ouvrir le sanitizer manuel"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-300 transition-all hover:bg-otter-500/15 hover:text-otter-200"
          >
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          </button>

          <div
            className="relative flex items-center"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={handleToggleCursor}
              aria-pressed={cursorOn}
              title={
                cursorOn
                  ? 'Curseur en évidence actif · halo + traînée colorée'
                  : 'Mettre le curseur en évidence (halo + traînée)'
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
              className="ml-0.5 inline-flex h-8 w-5 items-center justify-center rounded-md cursor-pointer hover:bg-white/[0.05]"
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
          </div>

          <button
            type="button"
            onClick={handleConsole}
            title="Ouvrir la console · bibliothèque, paramètres"
            aria-label="Ouvrir la console"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
          >
            <Layout className="h-4 w-4" strokeWidth={2} />
          </button>
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

      {sanitizerOpen && <SanitizerPopup onClose={() => setSanitizerOpen(false)} />}

      {liveOn && (
        <div
          role="status"
          className="pointer-events-auto absolute top-[110px] left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full glass px-3 py-1.5 text-[11px] text-otter-100 shadow-glass animate-fade-in-up"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-otter-400 animate-glow-pulse" aria-hidden />
            <span className="relative h-2 w-2 rounded-full bg-otter-400" aria-hidden />
          </span>
          <span className="font-semibold tracking-wide">
            {livePhase === 'acquiring' && 'Acquisition de l\'écran…'}
            {livePhase === 'loading-ocr' && 'Chargement OCR (Tesseract)…'}
            {livePhase === 'scanning' && 'Analyse en cours…'}
            {livePhase === 'idle' && liveStatus !== null && (
              liveStatus.count === 0
                ? `Aucun secret détecté · ${liveStatus.ms}ms`
                : `${liveStatus.count} secret${liveStatus.count > 1 ? 's' : ''} masqué${liveStatus.count > 1 ? 's' : ''} · ${liveStatus.ms}ms`
            )}
            {livePhase === null && 'Sanitizer LIVE actif'}
          </span>
        </div>
      )}

      {showShareHint && (
        <div
          role="status"
          className="pointer-events-auto absolute top-[100px] left-1/2 -translate-x-1/2 flex items-start gap-2.5 rounded-xl border border-otter-400/30 bg-deep-950/70 backdrop-blur-xl px-3.5 py-2 text-[11px] text-otter-100/90 shadow-glass animate-fade-in-up max-w-md"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-otter-300" strokeWidth={2} />
          <span className="leading-snug">
            Pour que tes annotations apparaissent dans Meet/Zoom, partage{' '}
            <strong className="text-otter-50">l'écran entier</strong> (pas un onglet).
          </span>
          <button
            type="button"
            onClick={() => setShowShareHint(false)}
            className="ml-1 text-otter-200/60 hover:text-otter-100"
            aria-label="Fermer l'info"
          >
            ✕
          </button>
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
