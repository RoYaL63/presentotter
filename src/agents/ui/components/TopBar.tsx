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
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-3 backdrop-blur">
      <button
        type="button"
        onClick={() => navigate('home')}
        className="flex items-center gap-2 text-lg font-bold text-slate-100"
      >
        <span aria-hidden>🦦</span>
        <span>PresentOtter</span>
      </button>

      <nav className="flex items-center gap-1" aria-label="Navigation principale">
        {ITEMS.map(({ id, label, Icon }) => {
          const active = currentPage === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
    </header>
  )
}
