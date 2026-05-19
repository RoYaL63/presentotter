import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Crosshair,
  Home as HomeIcon,
  Library as LibraryIcon,
  Power,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Wand2
} from 'lucide-react'
import { SanitizerPopup } from './SanitizerPopup'
import { Library } from './pages/Library'
import { Tools } from './pages/Tools'
import { Settings } from './pages/Settings'
import { useNavStore, type PageName } from './stores/useNavStore'
import { registerUIEventListeners } from './eventListeners'

/**
 * Home — the ONE-AND-ONLY window of PresentOtter.
 *
 * Holds four sections in a single React tree:
 *   - Accueil    (the original landing: toggle floating toolbar + brand)
 *   - Outils     (per-tool defaults editor + cursor settings)
 *   - Bibliothèque (recordings library list)
 *   - Paramètres (general app settings)
 *
 * No more secondary "console" BrowserWindow — every section lives here.
 * Closing this window quits the app; the floating toolbar / overlays live
 * in their own borderless windows and are toggled from the Accueil section.
 */

type SectionId = Extract<PageName, 'home' | 'tools' | 'library' | 'settings'>

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; Icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Accueil', Icon: HomeIcon },
  { id: 'tools', label: 'Outils', Icon: Sparkles },
  { id: 'library', label: 'Bibliothèque', Icon: LibraryIcon },
  { id: 'settings', label: 'Paramètres', Icon: SettingsIcon }
]

export function Home() {
  const currentPage = useNavStore((s) => s.currentPage)
  const navigate = useNavStore((s) => s.navigate)

  // Coerce any legacy/unsupported PageName (recording/preview) to 'home'.
  const section: SectionId = (
    ['home', 'tools', 'library', 'settings'] as SectionId[]
  ).includes(currentPage as SectionId)
    ? (currentPage as SectionId)
    : 'home'

  // Wire up the global event listeners (capture/library/export → stores) once
  // for the lifetime of the window — keeps the Library section in sync with
  // whatever the floating toolbar and the agents emit on the event bus.
  useEffect(() => {
    const teardown = registerUIEventListeners()
    return teardown
  }, [])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-deep-950 font-sans antialiased text-otter-50">
      {/* Floating background orbs (decorative, behind everything) */}
      <div className="liquid-bg">
        <div
          className="liquid-orb animate-orb-float-1 bg-otter-500"
          style={{ width: '520px', height: '520px', top: '-160px', left: '-120px' }}
          aria-hidden
        />
        <div
          className="liquid-orb animate-orb-float-2 bg-fur-500"
          style={{ width: '380px', height: '380px', top: '50%', right: '-120px' }}
          aria-hidden
        />
        <div
          className="liquid-orb animate-orb-float-3 bg-otter-300"
          style={{
            width: '440px',
            height: '440px',
            bottom: '-160px',
            left: '35%',
            opacity: 0.22
          }}
          aria-hidden
        />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <TopNav current={section} onSelect={navigate} />
        <main className="flex-1 overflow-y-auto">
          <div key={section} className="animate-fade-in-up">
            {renderSection(section)}
          </div>
        </main>
      </div>
    </div>
  )
}

function renderSection(section: SectionId): ReactElement {
  switch (section) {
    case 'tools':
      return <Tools />
    case 'library':
      return <Library />
    case 'settings':
      return <Settings />
    case 'home':
    default:
      return <AccueilSection />
  }
}

interface TopNavProps {
  current: SectionId
  onSelect(section: PageName): void
}

function TopNav({ current, onSelect }: TopNavProps) {
  return (
    <header className="glass glass-shine sticky top-0 z-30 flex items-center justify-between px-6 py-3 rounded-none border-x-0 border-t-0">
      <button
        type="button"
        onClick={() => onSelect('home')}
        className="group flex items-center gap-3 text-base font-semibold text-otter-50 transition-transform duration-200 hover:scale-[1.02]"
        aria-label="Retour à l'accueil"
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
        {SECTIONS.map(({ id, label, Icon }) => {
          const active = current === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
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

/**
 * Accueil section — toggle the floating toolbar, glance at status,
 * and shortcuts to manual sanitizer / library / etc.
 */
function AccueilSection() {
  const apiRef = useRef<PresentOtterAPI | undefined>(window.api)
  const [toolbarOn, setToolbarOn] = useState(false)
  const [sanitizerOpen, setSanitizerOpen] = useState(false)
  const navigate = useNavStore((s) => s.navigate)

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    void api.isToolbarEnabled().then((on) => setToolbarOn(on))
    const off = api.onToolbarStatus(({ enabled }) => setToolbarOn(enabled))
    return off
  }, [])

  const toggleToolbar = () => {
    const api = apiRef.current
    if (!api) return
    if (toolbarOn) api.disableToolbar()
    else api.enableToolbar()
  }

  return (
    <section className="mx-auto flex h-full max-w-4xl flex-col items-center justify-start gap-8 px-8 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-otter-400 to-otter-600 text-3xl shadow-glow-otter-lg ring-1 ring-otter-300/40"
          aria-hidden
        >
          🦦
        </div>
        <h1 className="text-4xl font-bold tracking-tight">
          Present<span className="text-otter-400">Otter</span>
        </h1>
        <p className="max-w-md text-sm text-otter-200/70">
          Annote, surligne et masque les secrets en direct par-dessus
          n&apos;importe quelle application pendant tes partages d&apos;écran.
        </p>
      </header>

      <button
        type="button"
        onClick={toggleToolbar}
        aria-pressed={toolbarOn}
        className={`group relative flex flex-col items-center gap-3 rounded-3xl px-12 py-8 transition-all duration-300 ease-out ${
          toolbarOn
            ? 'bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter-lg ring-1 ring-otter-300/40 hover:-translate-y-0.5'
            : 'glass glass-shine hover:bg-white/[0.08] hover:-translate-y-0.5'
        }`}
      >
        {toolbarOn && (
          <span
            className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-white/30 to-transparent pointer-events-none"
            aria-hidden
          />
        )}
        <Power
          className={`relative h-10 w-10 transition-transform duration-300 ${toolbarOn ? 'scale-110' : 'group-hover:scale-110'}`}
          strokeWidth={1.5}
        />
        <span className="relative text-base font-semibold tracking-tight">
          {toolbarOn ? 'Désactiver la barre d\'outils' : 'Activer la barre d\'outils'}
        </span>
        <span className="relative text-xs text-otter-50/70">
          {toolbarOn
            ? 'La barre flotte au-dessus de toutes tes apps'
            : 'Affiche la toolbar flottante au-dessus de toutes tes apps'}
        </span>
      </button>

      <div className="flex items-center gap-2 text-xs text-otter-200/60">
        <span
          className={`relative h-2 w-2 rounded-full ${toolbarOn ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-otter-700'}`}
          aria-hidden
        />
        <span>
          Toolbar {toolbarOn ? 'active' : 'inactive'} · l&apos;app reste ouverte
          tant que cette fenêtre est ouverte
        </span>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionCard
          icon={ShieldCheck}
          title="Sanitizer manuel"
          description="Vérifier un texte avant de le coller à l'écran"
          onClick={() => setSanitizerOpen(true)}
        />
        <ActionCard
          icon={Wand2}
          title="Configurer les outils"
          description="Couleurs et tailles par défaut de chaque outil"
          onClick={() => navigate('tools')}
        />
        <ActionCard
          icon={LibraryIcon}
          title="Bibliothèque"
          description="Tes enregistrements et exports précédents"
          onClick={() => navigate('library')}
        />
      </div>

      <div className="grid w-full max-w-2xl grid-cols-2 gap-3 text-xs text-otter-200/60 sm:grid-cols-4">
        <Feature icon={Wand2} label="Annotations" />
        <Feature icon={ShieldCheck} label="Sanitizer LIVE" />
        <Feature icon={Crosshair} label="Curseur tracé" />
        <Feature icon={Sparkles} label="Multi-écran" />
      </div>

      <footer className="mt-auto flex items-center gap-2 text-[11px] text-otter-200/40">
        <span>PresentOtter v0.1 · OTTERWISE</span>
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={() => navigate('settings')}
          className="inline-flex items-center gap-1 hover:text-otter-200"
        >
          <SettingsIcon className="h-3 w-3" /> Paramètres
        </button>
      </footer>

      {sanitizerOpen && <SanitizerPopup onClose={() => setSanitizerOpen(false)} />}
    </section>
  )
}

interface ActionCardProps {
  icon: typeof ShieldCheck
  title: string
  description: string
  onClick(): void
}

function ActionCard({ icon: Icon, title, description, onClick }: ActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass glass-interactive group flex items-start gap-3 rounded-2xl p-4 text-left"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.1] text-otter-200 transition-colors group-hover:text-otter-100">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div>
        <p className="text-sm font-semibold text-otter-50">{title}</p>
        <p className="mt-0.5 text-xs text-otter-200/60">{description}</p>
      </div>
    </button>
  )
}

interface FeatureProps {
  icon: typeof ShieldCheck
  label: string
}

function Feature({ icon: Icon, label }: FeatureProps) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-otter-300" strokeWidth={1.75} />
      <span>{label}</span>
    </div>
  )
}
