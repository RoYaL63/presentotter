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
 * Home — the ONE-AND-ONLY framed window of PresentOtter.
 *
 * Visually it's the only surface that is NOT transparent over the user's
 * desktop, so it gets the full otter-morphism light treatment:
 *   - Mesh aquatique background (glacier → cream radial mix)
 *   - Liquid Glass cards (white frosted, deep-sea text)
 *   - Coral Pop clay CTA for the primary action
 *   - Bubble float on the loutre mascot
 *
 * The toolbar + overlays (transparent windows) keep the dark Otter Glass
 * variant so icons stay legible over any user desktop background.
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

  const section: SectionId = (
    ['home', 'tools', 'library', 'settings'] as SectionId[]
  ).includes(currentPage as SectionId)
    ? (currentPage as SectionId)
    : 'home'

  useEffect(() => {
    const teardown = registerUIEventListeners()
    return teardown
  }, [])

  return (
    <div className="relative h-screen w-screen overflow-hidden otter-mesh font-sans antialiased text-sea-700">
      {/* Floating bubbles — aqua-mist, cream, coral. Pure decoration. */}
      <div className="liquid-bg">
        <div
          className="liquid-orb animate-orb-float-1 bg-sea-200"
          style={{ width: '520px', height: '520px', top: '-160px', left: '-120px' }}
          aria-hidden
        />
        <div
          className="liquid-orb animate-orb-float-2 bg-cream-100"
          style={{ width: '380px', height: '380px', top: '50%', right: '-120px' }}
          aria-hidden
        />
        <div
          className="liquid-orb animate-orb-float-3 bg-coral-200"
          style={{
            width: '440px',
            height: '440px',
            bottom: '-160px',
            left: '35%',
            opacity: 0.35
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
    <header className="otter-glass sticky top-0 z-30 mx-4 mt-4 flex items-center justify-between px-5 py-3">
      <button
        type="button"
        onClick={() => onSelect('home')}
        className="group flex items-center gap-3 text-base font-bold text-sea-700 transition-transform duration-200 hover:scale-[1.02]"
        aria-label="Retour à l'accueil"
      >
        <span
          className="otter-clay otter-aqua relative flex h-10 w-10 items-center justify-center text-xl"
          style={{ borderRadius: 16 }}
          aria-hidden
        >
          🦦
        </span>
        <span className="font-display tracking-tight text-lg">
          Present<span className="text-coral-400">Otter</span>
        </span>
      </button>

      <nav className="flex items-center gap-1" aria-label="Navigation principale">
        {SECTIONS.map(({ id, label, Icon }) => {
          const active = current === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                active
                  ? 'bg-white/70 text-sea-700 shadow-glass-sm ring-1 ring-coral-400/40'
                  : 'text-sea-700/70 hover:bg-white/40 hover:text-sea-700'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
    </header>
  )
}

/**
 * Accueil — toggle the floating toolbar + quick access cards.
 * Pure otter-morphism: cream clay, coral CTA, aqua sheen.
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
    <section className="mx-auto flex h-full max-w-4xl flex-col items-center justify-start gap-10 px-8 py-12">
      <header className="flex flex-col items-center gap-4 text-center">
        <div
          className="otter-clay otter-aqua animate-bubble-slow relative flex h-20 w-20 items-center justify-center text-4xl"
          aria-hidden
        >
          🦦
        </div>
        <h1 className="font-display text-5xl font-black tracking-tight text-sea-700">
          Present<span className="text-coral-400">Otter</span>
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-cream-800/70">
          Annote, surligne et masque les secrets en direct par-dessus
          n&apos;importe quelle app pendant tes partages d&apos;écran.
        </p>
      </header>

      <button
        type="button"
        onClick={toggleToolbar}
        aria-pressed={toolbarOn}
        className={`group relative flex flex-col items-center gap-3 px-14 py-9 transition-all duration-300 ease-out otter-aqua ${
          toolbarOn ? 'otter-clay-sea' : 'otter-clay-coral'
        }`}
        style={{ borderRadius: 36 }}
      >
        <Power
          className={`relative h-12 w-12 transition-transform duration-300 ${
            toolbarOn ? 'scale-110' : 'group-hover:scale-110'
          }`}
          strokeWidth={1.5}
        />
        <span className="relative text-base font-bold tracking-tight">
          {toolbarOn ? 'Désactiver la barre' : 'Activer la barre d\'outils'}
        </span>
        <span className="relative text-xs opacity-90">
          {toolbarOn
            ? 'La toolbar flotte au-dessus de tes apps'
            : 'Affiche la toolbar flottante au-dessus de tes apps'}
        </span>
      </button>

      <div className="flex items-center gap-2">
        <span className="otter-badge">
          <span
            className={`relative h-2 w-2 rounded-full ${
              toolbarOn
                ? 'bg-kelp-500 shadow-[0_0_8px_rgba(74,124,89,0.55)]'
                : 'bg-cream-400'
            }`}
            aria-hidden
          />
          Toolbar {toolbarOn ? 'active' : 'inactive'}
        </span>
        <span className="text-[11px] text-cream-800/55">
          · triple-tap <kbd className="font-mono text-cream-800">Alt</kbd> pour le curseur en évidence
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

      <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
        <Feature icon={Wand2} label="Annotations" />
        <Feature icon={ShieldCheck} label="Sanitizer LIVE" />
        <Feature icon={Crosshair} label="Curseur tracé" />
        <Feature icon={Sparkles} label="Multi-écran" />
      </div>

      <footer className="mt-auto flex items-center gap-2 text-[11px] text-cream-800/50">
        <span>PresentOtter v0.1 · 🦦 Otterwise Solutions</span>
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={() => navigate('settings')}
          className="inline-flex items-center gap-1 transition-colors hover:text-sea-700"
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
      className="otter-glass otter-aqua group flex items-start gap-3 p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-glow-aqua"
    >
      <div
        className="otter-clay flex h-11 w-11 flex-shrink-0 items-center justify-center text-sea-700 transition-colors group-hover:text-coral-500"
        style={{ borderRadius: 14 }}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="relative">
        <p className="text-sm font-bold text-sea-700">{title}</p>
        <p className="mt-1 text-xs leading-snug text-cream-800/65">{description}</p>
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
    <div className="otter-badge !rounded-2xl !py-2.5 justify-center">
      <Icon className="h-3.5 w-3.5 text-coral-400" strokeWidth={2} />
      <span>{label}</span>
    </div>
  )
}
