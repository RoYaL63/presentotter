import { Library, Settings as SettingsIcon, Video } from 'lucide-react'
import { useNavStore, type PageName } from '../stores/useNavStore'

interface NavItem {
  id: PageName
  label: string
  Icon: typeof Video
}

const ITEMS: ReadonlyArray<NavItem> = [
  { id: 'home', label: 'Accueil', Icon: Video },
  { id: 'library', label: 'Bibliothèque', Icon: Library },
  { id: 'settings', label: 'Paramètres', Icon: SettingsIcon }
]

export function TopBar() {
  const currentPage = useNavStore((s) => s.currentPage)
  const navigate = useNavStore((s) => s.navigate)

  return (
    <header className="glass glass-shine sticky top-0 z-30 flex items-center justify-between px-6 py-3 rounded-none border-x-0 border-t-0">
      <button
        type="button"
        onClick={() => navigate('home')}
        className="group flex items-center gap-3 text-base font-semibold text-otter-50 transition-transform duration-200 hover:scale-[1.02]"
        aria-label="Retour accueil PresentOtter"
      >
        <span
          className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-otter-400 to-otter-600 text-xl shadow-glow-otter ring-1 ring-otter-300/40"
          aria-hidden
        >
          🦦
          <span className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/30 to-transparent" />
        </span>
        <span className="font-display tracking-tight">
          Present<span className="text-otter-400">Otter</span>
        </span>
      </button>

      <nav className="flex items-center gap-1.5" aria-label="Navigation principale">
        {ITEMS.map(({ id, label, Icon }) => {
          const active = currentPage === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                active
                  ? 'bg-white/[0.1] text-otter-50 shadow-glass-sm ring-1 ring-otter-400/30'
                  : 'text-otter-200/70 hover:bg-white/[0.05] hover:text-otter-50'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              <span>{label}</span>
              {active && (
                <span
                  className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-otter-400 to-transparent"
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </nav>
    </header>
  )
}
