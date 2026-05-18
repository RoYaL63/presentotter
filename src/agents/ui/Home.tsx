import { useEffect, useRef, useState } from 'react'
import {
  Crosshair,
  Library,
  Power,
  Settings,
  ShieldCheck,
  Sparkles,
  Wand2
} from 'lucide-react'
import { SanitizerPopup } from './SanitizerPopup'

/**
 * Home — the primary window users land on when they launch PresentOtter.
 *
 * One big call to action: "Activate the floating toolbar". Once activated,
 * the toolbar + overlays come up on top of every app (Meet, Zoom, Chrome…)
 * and can be controlled by global shortcuts. The Home stays available in
 * the background; closing it quits the app, minimizing it does not.
 */
export function Home() {
  const apiRef = useRef<PresentOtterAPI | undefined>(window.api)
  const [toolbarOn, setToolbarOn] = useState(false)
  const [sanitizerOpen, setSanitizerOpen] = useState(false)

  // Initial state + subscribe to status changes from main
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
    <div className="relative h-screen w-screen overflow-hidden bg-deep-950 font-sans antialiased text-otter-50">
      {/* Floating background orbs */}
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

      <main className="relative z-10 mx-auto flex h-full max-w-4xl flex-col items-center justify-center gap-8 px-8 py-12 overflow-y-auto">
        {/* Brand */}
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
            n'importe quelle application pendant tes partages d'écran.
          </p>
        </header>

        {/* Big toggle */}
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

        {/* Status pill */}
        <div className="flex items-center gap-2 text-xs text-otter-200/60">
          <span
            className={`relative h-2 w-2 rounded-full ${toolbarOn ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-otter-700'}`}
            aria-hidden
          />
          <span>
            Toolbar {toolbarOn ? 'active' : 'inactive'} · l'app reste ouverte tant que cette fenêtre est ouverte
          </span>
        </div>

        {/* Quick actions row */}
        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionCard
            icon={ShieldCheck}
            title="Sanitizer manuel"
            description="Vérifier un texte avant de le pasted à l'écran"
            onClick={() => setSanitizerOpen(true)}
          />
          <ActionCard
            icon={Library}
            title="Bibliothèque"
            description="Tes enregistrements et exports précédents"
            onClick={() => apiRef.current?.openConsole()}
          />
        </div>

        {/* Feature hints */}
        <div className="grid w-full max-w-2xl grid-cols-2 gap-3 text-xs text-otter-200/60 sm:grid-cols-4">
          <Feature icon={Wand2} label="Annotations" />
          <Feature icon={ShieldCheck} label="Sanitizer LIVE" />
          <Feature icon={Crosshair} label="Curseur tracé" />
          <Feature icon={Sparkles} label="Multi-écran" />
        </div>

        {/* Footer */}
        <footer className="mt-auto flex items-center gap-2 text-[11px] text-otter-200/40">
          <span>PresentOtter v0.1 · OTTERWISE</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => apiRef.current?.openConsole()}
            className="inline-flex items-center gap-1 hover:text-otter-200"
          >
            <Settings className="h-3 w-3" /> Paramètres
          </button>
        </footer>
      </main>

      {sanitizerOpen && <SanitizerPopup onClose={() => setSanitizerOpen(false)} />}
    </div>
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
