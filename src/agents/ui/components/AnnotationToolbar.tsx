import { ArrowUpRight, Circle, MousePointer2, Pencil, Square, Sun, Type } from 'lucide-react'
import type { AnnotationType } from '@interfaces'
import { useAnnotationStore, type AnnotationMode } from '../stores/useAnnotationStore'

const TOOLS: ReadonlyArray<{ id: AnnotationType; label: string; Icon: typeof Pencil }> = [
  { id: 'freeform', label: 'Dessin libre', Icon: Pencil },
  { id: 'rectangle', label: 'Rectangle', Icon: Square },
  { id: 'circle', label: 'Cercle', Icon: Circle },
  { id: 'arrow', label: 'Flèche', Icon: ArrowUpRight },
  { id: 'text', label: 'Texte', Icon: Type },
  { id: 'spotlight', label: 'Spotlight', Icon: Sun }
]

export function AnnotationToolbar() {
  const mode = useAnnotationStore((s) => s.mode)
  const color = useAnnotationStore((s) => s.color)
  const opacity = useAnnotationStore((s) => s.opacity)
  const setMode = useAnnotationStore((s) => s.setMode)
  const setColor = useAnnotationStore((s) => s.setColor)
  const setOpacity = useAnnotationStore((s) => s.setOpacity)

  const handleModeClick = (id: AnnotationType) => {
    const next: AnnotationMode = mode === id ? 'off' : id
    setMode(next)
  }

  return (
    <div className="glass glass-shine flex flex-wrap items-center gap-2 rounded-2xl p-3">
      <button
        type="button"
        onClick={() => setMode('off')}
        aria-pressed={mode === 'off'}
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ${
          mode === 'off'
            ? 'bg-white/[0.1] text-otter-50 shadow-glass-sm ring-1 ring-otter-400/30'
            : 'text-otter-200/70 hover:bg-white/[0.06] hover:text-otter-50'
        }`}
      >
        <MousePointer2 className="h-4 w-4" strokeWidth={1.75} />
        <span>Aucun</span>
      </button>

      <div className="h-7 w-px bg-white/[0.08]" aria-hidden />

      {TOOLS.map(({ id, label, Icon }) => {
        const active = mode === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleModeClick(id)}
            aria-pressed={active}
            title={label}
            className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
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

      <div className="h-7 w-px bg-white/[0.08]" aria-hidden />

      <label className="flex items-center gap-2.5 text-sm text-otter-200/80">
        <span className="text-xs uppercase tracking-wider">Couleur</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Couleur d'annotation"
          className="h-8 w-10 cursor-pointer rounded-lg border border-white/[0.15] bg-transparent shadow-glass-sm"
        />
      </label>

      <label className="flex items-center gap-2.5 text-sm text-otter-200/80">
        <span className="text-xs uppercase tracking-wider">Opacité</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          aria-label="Opacité d'annotation"
          className="h-1.5 w-28 cursor-pointer accent-otter-400"
        />
        <span className="w-10 text-right text-xs font-medium text-otter-300 tabular-nums">
          {Math.round(opacity * 100)}%
        </span>
      </label>
    </div>
  )
}
