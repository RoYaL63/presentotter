import { useEffect } from 'react'
import { Keyboard, X } from 'lucide-react'

/**
 * Cheat-sheet modal listing every keyboard shortcut PresentOtter
 * exposes. Rendered in the Home window (where there's room) — the
 * Toolbar ? button asks main to focus Home + open this modal via the
 * same IPC pattern as the sanitizer popup.
 *
 * Shortcuts are grouped by intent so the user can find what they need
 * without scanning a 12-row table.
 */

interface ShortcutsHelpProps {
  onClose(): void
}

interface ShortcutRow {
  combo: string[]
  label: string
  /** Optional second-line hint. */
  note?: string
}

interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Outils d\'annotation',
    rows: [
      { combo: ['Alt', 'P'], label: 'Crayon' },
      { combo: ['Alt', 'R'], label: 'Rectangle' },
      { combo: ['Alt', 'O'], label: 'Cercle' },
      { combo: ['Alt', 'A'], label: 'Flèche' },
      { combo: ['Alt', 'T'], label: 'Texte' },
      { combo: ['Alt', 'L'], label: 'Spotlight', note: 'Suit le curseur' },
      { combo: ['Alt', 'S'], label: 'Passe-through', note: 'Idem que cliquer une seconde fois sur l\'outil actif' },
      { combo: ['Echap'], label: 'Sortir de l\'outil actif' }
    ]
  },
  {
    title: 'Manipuler les annotations',
    rows: [
      { combo: ['Alt', 'Z'], label: 'Annuler le dernier trait' },
      {
        combo: ['Clic droit'],
        label: 'Annuler le dernier trait',
        note: 'Sur la zone de dessin, depuis n\'importe quel outil'
      },
      { combo: ['Alt', 'Shift', 'C'], label: 'Tout effacer' }
    ]
  },
  {
    title: 'Affichage',
    rows: [
      { combo: ['Alt', 'H'], label: 'Masquer / afficher les annotations' },
      { combo: ['Alt', 'B'], label: 'Masquer / afficher la toolbar' }
    ]
  },
  {
    title: 'Curseur',
    rows: [
      {
        combo: ['Alt', 'Alt', 'Alt'],
        label: 'Curseur en évidence',
        note: 'Triple-tap rapide sur Alt depuis n\'importe où'
      }
    ]
  }
]

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  // Escape closes — same pattern as the sanitizer popup so the user has
  // a consistent way out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Raccourcis clavier"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 backdrop-blur-md"
      style={{ background: 'rgba(7, 33, 47, 0.42)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="otter-glass otter-aqua w-full max-w-xl rounded-3xl p-5 animate-fade-in-up">
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="otter-clay flex h-10 w-10 items-center justify-center text-sea-700"
              style={{ borderRadius: 14 }}
            >
              <Keyboard className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-sea-700">
                Raccourcis clavier
              </h2>
              <p className="text-xs text-cream-800/70">
                Tout passe par <kbd className="rounded bg-white/55 px-1.5 py-0.5 font-mono text-[10px] text-sea-700 ring-1 ring-white/60">Alt</kbd> + lettre.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-sea-700/70 transition-colors hover:bg-coral-500/15 hover:text-coral-500"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className="rounded-2xl bg-white/45 p-3 ring-1 ring-white/55">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.rows.map((row) => (
                  <li key={row.label} className="flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sea-700">{row.label}</p>
                      {row.note !== undefined && (
                        <p className="mt-0.5 text-[10px] leading-snug text-cream-800/65">
                          {row.note}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {row.combo.map((key, idx) => (
                        <kbd
                          key={`${key}-${idx}`}
                          className="rounded-md bg-white/85 px-2 py-0.5 font-mono text-[11px] font-semibold text-sea-700 ring-1 ring-sea-700/15 shadow-clay-sm"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-snug text-cream-800/60">
          Astuce : cliquer une seconde fois sur l&apos;icône d&apos;un outil actif te ramène au mode passe-through. Plus besoin d&apos;Échap pour sortir d&apos;un crayon.
        </p>
      </div>
    </div>
  )
}
