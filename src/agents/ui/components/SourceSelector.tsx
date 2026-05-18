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
  { id: 'screen', label: 'Écran complet', description: "Capture tout l'écran", Icon: Monitor },
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
            aria-pressed={isActive}
            className={`group relative overflow-hidden rounded-2xl p-5 text-left transition-all duration-300 ease-out
              ${isActive
                ? 'bg-gradient-to-br from-otter-500/20 to-otter-700/10 border border-otter-400/50 shadow-glow-otter ring-1 ring-otter-300/30'
                : 'glass glass-interactive hover:-translate-y-0.5'}
            `}
          >
            {/* Top highlight shine */}
            <span
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none"
              aria-hidden
            />

            <div className="flex flex-col items-start gap-3.5">
              <div
                className={`relative flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-300
                  ${isActive
                    ? 'bg-gradient-to-br from-otter-400 to-otter-600 shadow-glow-otter text-white ring-1 ring-otter-300/40'
                    : 'bg-white/[0.06] border border-white/[0.1] text-otter-200 group-hover:bg-white/[0.1] group-hover:text-otter-100'}
                `}
              >
                <Icon className="h-5.5 w-5.5" strokeWidth={1.75} />
                {isActive && (
                  <span
                    className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/30 to-transparent pointer-events-none"
                    aria-hidden
                  />
                )}
              </div>
              <div>
                <p className={`text-base font-semibold ${isActive ? 'text-otter-50' : 'text-otter-100'}`}>
                  {label}
                </p>
                <p className="mt-0.5 text-sm text-otter-200/60">{description}</p>
              </div>
            </div>

            {/* Active glow underline */}
            {isActive && (
              <span
                className="absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-transparent via-otter-300/80 to-transparent"
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
