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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 p-3">
      <button
        type="button"
        onClick={() => setMode('off')}
        aria-pressed={mode === 'off'}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
          mode === 'off' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-100'
        }`}
      >
        <MousePointer2 className="h-4 w-4" />
        <span>Aucun</span>
      </button>

      <div className="h-6 w-px bg-slate-700" aria-hidden />

      {TOOLS.map(({ id, label, Icon }) => {
        const active = mode === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleModeClick(id)}
            aria-pressed={active}
            title={label}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              active ? 'bg-otter-500 text-white' : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        )
      })}

      <div className="h-6 w-px bg-slate-700" aria-hidden />

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <span>Couleur</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Couleur d'annotation"
          className="h-8 w-10 cursor-pointer rounded border border-slate-600 bg-transparent"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <span>Opacité</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          aria-label="Opacité d'annotation"
          className="h-1 w-24 cursor-pointer accent-otter-500"
        />
        <span className="w-8 text-right text-xs text-slate-400">{Math.round(opacity * 100)}%</span>
      </label>
    </div>
  )
}
