import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Eraser,
  GripVertical,
  Layout,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Sun,
  Type,
  Undo2,
  X
} from 'lucide-react'

const TOOLS = [
  { id: 'select', label: 'Sélection (passe-through)', Icon: MousePointer2 },
  { id: 'pencil', label: 'Crayon', Icon: Pencil },
  { id: 'rectangle', label: 'Rectangle', Icon: Square },
  { id: 'circle', label: 'Cercle', Icon: Circle },
  { id: 'arrow', label: 'Flèche', Icon: ArrowUpRight },
  { id: 'text', label: 'Texte', Icon: Type },
  { id: 'spotlight', label: 'Spotlight', Icon: Sun }
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
  const apiRef = useRef<PresentOtterAPI | undefined>(window.api)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClear = () => apiRef.current?.clearOverlay()
  const handleUndo = () => apiRef.current?.undoOverlay()
  const handleConsole = () => apiRef.current?.openConsole()
  const handleClose = () => apiRef.current?.toolbarClose()

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
          className="flex h-9 w-5 items-center justify-center text-otter-200/40 cursor-grab active:cursor-grabbing"
          title="Glisser pour déplacer"
          aria-hidden
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.5} />
        </div>

        {/* Logo */}
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-otter-400 to-otter-600 text-lg shadow-glow-otter ring-1 ring-otter-300/40 mr-1" aria-hidden>
          🦦
        </div>

        <div className="h-7 w-px bg-white/[0.08]" aria-hidden />

        {/* Tools */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {TOOLS.map(({ id, label, Icon }) => {
            const active = tool === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => sendTool(id)}
                aria-pressed={active}
                aria-label={label}
                title={label}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 ${
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
                className={`relative h-6 w-6 rounded-full transition-all duration-200 ${
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
              className="h-1 w-16 cursor-pointer accent-otter-400"
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
            title="Annuler (dernier trait)"
            aria-label="Annuler"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
          >
            <Undo2 className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleClear}
            title="Tout effacer"
            aria-label="Tout effacer"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-otter-200/80 transition-all hover:bg-red-500/15 hover:text-red-200"
          >
            <Eraser className="h-4 w-4" strokeWidth={2} />
          </button>

          <div className="mx-1 h-7 w-px bg-white/[0.08]" aria-hidden />

          <button
            type="button"
            onClick={handleConsole}
            title="Ouvrir la console (bibliothèque, paramètres)"
            aria-label="Ouvrir la console"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
          >
            <Layout className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleMinimize}
            title="Réduire en bulle"
            aria-label="Réduire"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-otter-200/80 transition-all hover:bg-white/[0.06] hover:text-otter-50"
          >
            <Minus className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="Quitter"
            aria-label="Quitter"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-otter-200/80 transition-all hover:bg-red-500/20 hover:text-red-200"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Opacity is wired up but kept off the visible toolbar for now */}
      <div className="sr-only" aria-hidden>
        Opacité: {opacity}
      </div>
    </div>
  )
}
