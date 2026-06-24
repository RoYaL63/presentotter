import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import {
  Camera,
  Home as HomeIcon,
  Keyboard,
  Library as LibraryIcon,
  Moon,
  MonitorPlay,
  Power,
  Sun,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Video,
  Wand2
} from 'lucide-react'
import { SanitizerPopup } from './SanitizerPopup'
import { RecordingPanel } from './RecordingPanel'
import { ShortcutsHelp } from './ShortcutsHelp'
import { Mascot } from './components/Mascot'
import { Library } from './pages/Library'
import { Tools } from './pages/Tools'
import { Settings } from './pages/Settings'
import { Mirror } from './Mirror'
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

type SectionId = Extract<PageName, 'home' | 'tools' | 'library' | 'mirror' | 'settings'>

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; Icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Accueil', Icon: HomeIcon },
  { id: 'tools', label: 'Outils', Icon: Sparkles },
  { id: 'library', label: 'Bibliothèque', Icon: LibraryIcon },
  { id: 'mirror', label: 'Miroir Meet', Icon: MonitorPlay },
  { id: 'settings', label: 'Paramètres', Icon: SettingsIcon }
]

export function Home() {
  const currentPage = useNavStore((s) => s.currentPage)
  const navigate = useNavStore((s) => s.navigate)

  // Day/night theme — opt-in, defaults to day so nothing changes for
  // users who don't toggle. Persisted in localStorage; the night CSS is
  // scoped under html[data-mode='home'][data-theme='night'].
  const [theme, setTheme] = useState<'day' | 'night'>(() => {
    try {
      return localStorage.getItem('po-theme') === 'night' ? 'night' : 'day'
    } catch {
      return 'day'
    }
  })
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    try {
      localStorage.setItem('po-theme', theme)
    } catch {
      // localStorage blocked — theme just won't persist
    }
  }, [theme])

  const section: SectionId = (
    ['home', 'tools', 'library', 'mirror', 'settings'] as SectionId[]
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
        <TopNav
          current={section}
          onSelect={navigate}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'day' ? 'night' : 'day'))}
        />
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
    case 'mirror':
      return <Mirror />
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
  theme: 'day' | 'night'
  onToggleTheme(): void
}

function TopNav({ current, onSelect, theme, onToggleTheme }: TopNavProps) {
  // Goutte de navigation — the signature OtterMorphisme indicator. An
  // absolutely-positioned "drop" slides (and briefly stretches) behind
  // the active tab. We measure the active button's geometry on every
  // change and animate left/width via CSS. Pure layout measurement, no
  // extra state churn beyond the drop rect.
  const navRef = useRef<HTMLElement | null>(null)
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const dropRef = useRef<HTMLSpanElement | null>(null)
  const [drop, setDrop] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    const btn = btnRefs.current[current]
    if (nav === null || btn === null || btn === undefined) return
    const navBox = nav.getBoundingClientRect()
    const btnBox = btn.getBoundingClientRect()
    setDrop({ left: btnBox.left - navBox.left, width: btnBox.width })
    // Replay the stretch keyframe each move so the drop "reforms".
    const d = dropRef.current
    if (d !== null) {
      d.classList.remove('nav-drop-move')
      void d.offsetWidth // force reflow
      d.classList.add('nav-drop-move')
    }
  }, [current])

  return (
    <header className="otter-glass sticky top-0 z-30 mx-4 mt-4 flex items-center justify-between px-5 py-3">
      <button
        type="button"
        onClick={() => onSelect('home')}
        className="group flex items-center gap-3 text-base font-bold text-sea-700 transition-transform duration-200 hover:scale-[1.02]"
        aria-label="Retour à l'accueil"
      >
        <span
          className="otter-clay otter-aqua relative flex h-12 w-12 items-center justify-center overflow-hidden"
          style={{ borderRadius: 16 }}
          aria-hidden
        >
          <Mascot size={42} />
        </span>
        <span className="font-display tracking-tight text-lg">
          Present<span className="riv-underline">Otter</span>
        </span>
      </button>

      <div className="flex items-center gap-2">
      <nav
        ref={navRef}
        className="relative flex items-center gap-1"
        aria-label="Navigation principale"
      >
        {/* The sliding drop sits behind the buttons. */}
        {drop !== null && (
          <span
            ref={dropRef}
            className="nav-drop pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full"
            style={{ left: drop.left, width: drop.width, height: 36 }}
            aria-hidden
          />
        )}
        {SECTIONS.map(({ id, label, Icon }) => {
          const active = current === id
          return (
            <button
              key={id}
              ref={(el) => {
                btnRefs.current[id] = el
              }}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative z-10 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
                active
                  ? 'text-sea-700'
                  : 'text-sea-700/70 hover:text-sea-700'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

        {/* Day / night toggle — pill in the navbar, sun ↔ moon. */}
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'day' ? 'Passer en mode nuit' : 'Passer en mode jour'}
          title={theme === 'day' ? 'Mode nuit' : 'Mode jour'}
          className="otter-clay relative flex h-9 w-9 items-center justify-center rounded-full text-sea-700 transition-transform duration-200 hover:scale-105 active:scale-95"
        >
          {theme === 'day' ? (
            <Moon className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Sun className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
      </div>
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
  const [recordingOpen, setRecordingOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const navigate = useNavStore((s) => s.navigate)

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    void api.isToolbarEnabled().then((on) => setToolbarOn(on))
    const off = api.onToolbarStatus(({ enabled }) => setToolbarOn(enabled))
    return off
  }, [])

  // Toolbar (other window) can ask us to open the manual sanitizer
  // popup — listen here, then setSanitizerOpen so it renders in the
  // Home window which has the vertical room for the modal.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const off = api.onOpenSanitizer(() => setSanitizerOpen(true))
    return off
  }, [])

  // Shortcuts cheat sheet — same pattern as the sanitizer popup.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const off = api.onOpenShortcuts(() => setShortcutsOpen(true))
    return off
  }, [])

  const toggleToolbar = () => {
    const api = apiRef.current
    if (!api) return
    if (toolbarOn) api.disableToolbar()
    else api.enableToolbar()
  }

  return (
    <section className="mx-auto flex h-full max-w-5xl flex-col gap-4 px-6 pb-3 pt-4">
      {/* HERO — mascot to the left of the title in a single line so it
          stops eating vertical space. The bubble float still reads. */}
      <header className="flex items-center justify-center gap-5 text-center">
        <div className="relative shrink-0" aria-hidden>
          <div className="absolute inset-0 -z-10 rounded-full bg-coral-200/40 blur-2xl" />
          <Mascot size={96} animate />
        </div>
        <div className="text-left">
          <h1 className="font-display text-3xl font-black leading-none tracking-tight text-sea-700">
            Present<span className="riv-underline">Otter</span>
          </h1>
          <p className="mt-1 max-w-md text-xs leading-snug text-cream-800/75">
            Annote, surligne et masque les secrets en direct par-dessus
            n&apos;importe quelle app pendant tes partages d&apos;écran.
          </p>
        </div>
      </header>

      {/* PRIMARY CTA — single-row pill, status pill folded into the
          right edge so we don't need a separate row for it. */}
      <button
        type="button"
        onClick={toggleToolbar}
        aria-pressed={toolbarOn}
        className={`group relative flex items-center justify-between gap-4 px-6 py-4 transition-all duration-300 ease-out otter-aqua ${
          toolbarOn ? 'otter-clay-sea' : 'otter-clay-coral'
        }`}
        style={{ borderRadius: 24 }}
      >
        <span className="flex items-center gap-3">
          <Power
            className={`h-7 w-7 transition-transform duration-300 ${
              toolbarOn ? 'scale-110' : 'group-hover:scale-110'
            }`}
            strokeWidth={1.7}
          />
          <span className="flex flex-col items-start">
            <span className="text-sm font-bold tracking-tight">
              {toolbarOn ? 'Désactiver la barre' : 'Activer la barre d\'outils'}
            </span>
            <span className="text-[11px] opacity-90">
              {toolbarOn
                ? 'La toolbar flotte au-dessus de tes apps'
                : 'Affiche la toolbar flottante au-dessus de tes apps'}
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
          <span
            className={`relative h-1.5 w-1.5 rounded-full ${
              toolbarOn
                ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.85)]'
                : 'bg-white/65'
            }`}
            aria-hidden
          />
          {toolbarOn ? 'Active' : 'Inactive'}
        </span>
      </button>

      {/* QUICK ACTIONS — 6 cards, two rows of three. Capture leads because
          it's the new headline action (Snipping-Tool replacement). */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <ActionCard
          icon={Camera}
          title="Capture d'écran"
          description="Zone, copie auto, Alt+Maj+S"
          onClick={() => window.api?.captureStart('photo')}
          highlight
        />
        <ActionCard
          icon={Video}
          title="Enregistrer"
          description="Écran, audio, webcam, fond"
          onClick={() => setRecordingOpen(true)}
        />
        <ActionCard
          icon={MonitorPlay}
          title="Miroir Meet"
          description="Page à partager dans Meet/Zoom"
          onClick={() => navigate('mirror')}
        />
        <ActionCard
          icon={ShieldCheck}
          title="Sanitizer manuel"
          description="Vérifier un texte avant de coller"
          onClick={() => setSanitizerOpen(true)}
        />
        <ActionCard
          icon={Wand2}
          title="Outils"
          description="Couleurs et tailles par défaut"
          onClick={() => navigate('tools')}
        />
        <ActionCard
          icon={LibraryIcon}
          title="Bibliothèque"
          description="Enregistrements et exports"
          onClick={() => navigate('library')}
        />
      </div>

      {/* SHORTCUTS — inline cheat sheet so the user discovers them
          without opening the help modal. The Escape chip is rendered
          first and styled larger because exiting a tool is the action
          most users reach for; the rest is one click away. */}
      <div className="otter-glass otter-aqua flex flex-wrap items-center gap-2 px-3 py-2 text-[11px] text-sea-700">
        <Keyboard className="h-3.5 w-3.5 flex-shrink-0 text-coral-500" strokeWidth={2} />
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-sea-700/70">
          Raccourcis
        </span>
        {/* Pinned Escape chip — emphasized so the user can't miss it.
            Coral background, bigger kbd, label "Quitter l'outil". */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-coral-500 px-2.5 py-1 text-white ring-1 ring-coral-300/50 shadow-glow-coral"
          title="Sortir de l'outil actif et revenir en passe-through"
        >
          <kbd className="rounded bg-white/95 px-2 py-0.5 font-mono text-[11px] font-bold text-coral-700 ring-1 ring-coral-700/15">
            Échap
          </kbd>
          <span className="text-[11px] font-bold">Quitter l&apos;outil</span>
        </span>
        <ShortcutChip combo={['Alt', 'Maj', 'S']} label="Capture" />
        <ShortcutChip combo={['Alt', 'P']} label="Crayon" />
        <ShortcutChip combo={['Alt', 'R']} label="Rectangle" />
        <ShortcutChip combo={['Alt', 'T']} label="Texte" />
        <ShortcutChip combo={['Alt', 'L']} label="Spotlight" />
        <ShortcutChip combo={['Clic droit']} label="Annuler" />
        <ShortcutChip combo={['Alt', 'Alt', 'Alt']} label="Curseur" />
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[10px] font-semibold text-sea-700 ring-1 ring-white/60 transition hover:bg-white/85"
        >
          Voir tous
        </button>
      </div>

      {/* FOOTER — version + tip + settings shortcut on a single row.
          Version is INJECTED from package.json at build (vite define
          __APP_VERSION__) so it can never drift from the actual
          installed build. Click → opens the Settings → Mises à jour
          section directly so the user can check / download. */}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 text-xs text-cream-800/70">
        <span className="inline-flex items-center gap-1.5">
          Triple-tap{' '}
          <kbd className="rounded bg-white/55 px-2 py-0.5 font-mono text-[11px] font-semibold text-sea-700 ring-1 ring-white/60">
            Alt
          </kbd>{' '}
          pour le curseur en évidence
        </span>
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('settings')}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/55 px-3 py-1 font-semibold text-sea-700 ring-1 ring-white/65 transition hover:bg-white/85"
            title="Voir les paramètres et chercher une mise à jour"
          >
            <span>PresentOtter v{__APP_VERSION__}</span>
            <span aria-hidden>·</span>
            <span>🦦 Otterwise</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('settings')}
            className="inline-flex items-center gap-1 text-sea-700/70 transition-colors hover:text-sea-700"
          >
            <SettingsIcon className="h-3.5 w-3.5" /> Paramètres
          </button>
        </span>
      </footer>

      {sanitizerOpen && <SanitizerPopup onClose={() => setSanitizerOpen(false)} />}
      {recordingOpen && <RecordingPanel onClose={() => setRecordingOpen(false)} />}
      {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}
    </section>
  )
}

interface ActionCardProps {
  icon: typeof ShieldCheck
  title: string
  description: string
  onClick(): void
  /** Surface the card as the primary call-to-action on the page. */
  highlight?: boolean
}

function ActionCard({ icon: Icon, title, description, onClick, highlight = false }: ActionCardProps) {
  // Compact card — single icon column + 2-line text. Fits 4 in a row
  // on the Home without scrolling.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-2.5 p-2.5 text-left transition-all duration-300 hover:-translate-y-1 ${
        highlight
          ? 'otter-clay-coral otter-aqua text-white shadow-glow-mint'
          : 'otter-glass otter-aqua hover:shadow-glow-mint'
      }`}
      style={highlight ? { borderRadius: 18 } : undefined}
    >
      <div
        className={
          highlight
            ? 'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/25 text-white'
            : 'otter-clay flex h-9 w-9 flex-shrink-0 items-center justify-center text-sea-700 transition-colors group-hover:text-coral-500'
        }
        style={highlight ? undefined : { borderRadius: 12 }}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div className="relative min-w-0">
        <p
          className={
            highlight
              ? 'truncate text-xs font-bold text-white'
              : 'truncate text-xs font-bold text-sea-700'
          }
        >
          {title}
        </p>
        <p
          className={
            highlight
              ? 'mt-0.5 truncate text-[10px] text-white/85'
              : 'mt-0.5 truncate text-[10px] text-cream-800/65'
          }
        >
          {description}
        </p>
      </div>
    </button>
  )
}

interface ShortcutChipProps {
  combo: string[]
  label: string
}

function ShortcutChip({ combo, label }: ShortcutChipProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-white/50 px-2 py-0.5 ring-1 ring-white/55"
      title={`${label} : ${combo.join(' + ')}`}
    >
      <span className="flex items-center gap-0.5">
        {combo.map((key, idx) => (
          <kbd
            key={`${key}-${idx}`}
            className="rounded bg-white/85 px-1.5 py-0 font-mono text-[10px] font-semibold text-sea-700 ring-1 ring-sea-700/15"
          >
            {key}
          </kbd>
        ))}
      </span>
      <span className="text-[10px] font-semibold text-sea-700/85">{label}</span>
    </span>
  )
}

