import { AppWindow, Monitor, Square } from 'lucide-react'
import type { CaptureConfig } from '@interfaces'

type SourceKind = CaptureConfig['source']

interface SourceSelectorProps {
  selected: SourceKind
  onSelect: (source: SourceKind) => void
}

const SOURCES: ReadonlyArray<{
  id: SourceKind
  label: string
  description: string
  Icon: typeof Monitor
}> = [
  { id: 'screen', label: 'Écran complet', description: 'Capture tout l\'écran', Icon: Monitor },
  { id: 'region', label: 'Région', description: 'Sélection rectangulaire', Icon: Square },
  { id: 'window', label: 'Fenêtre', description: 'Une application précise', Icon: AppWindow }
]

export function SourceSelector({ selected, onSelect }: SourceSelectorProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {SOURCES.map(({ id, label, description, Icon }) => {
        const isActive = selected === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={`flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all ${
              isActive
                ? 'border-otter-500 bg-slate-800 ring-2 ring-otter-500/40'
                : 'border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800'
            }`}
            aria-pressed={isActive}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                isActive ? 'bg-otter-500/20 text-otter-500' : 'bg-slate-700 text-slate-300'
              }`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-100">{label}</p>
              <p className="text-sm text-slate-400">{description}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
