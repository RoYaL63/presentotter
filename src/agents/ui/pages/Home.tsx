import { useState } from 'react'
import { ArrowUpRight, PenTool, ShieldCheck, Sparkles, Video } from 'lucide-react'
import type { CaptureConfig } from '@interfaces'
import { RecordButton } from '../components/RecordButton'
import { SourceSelector } from '../components/SourceSelector'
import { useNavStore } from '../stores/useNavStore'
import { orchestrator } from '../orchestrator'

const DEFAULT_CONFIG: CaptureConfig = {
  source: 'screen',
  width: 1920,
  height: 1080,
  fps: 30,
  audioInputs: {
    system: true,
    microphone: true
  }
}

export function Home() {
  const [source, setSource] = useState<CaptureConfig['source']>('screen')
  const navigate = useNavStore((s) => s.navigate)

  const handleStart = async () => {
    const config: CaptureConfig = { ...DEFAULT_CONFIG, source }
    try {
      await orchestrator.startCapture(config)
      navigate('recording')
    } catch {
      // l'event bus 'capture:error' sera capté ailleurs ; pas de UI feedback P0
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-8 lg:p-12">
      <div className="grid gap-8 rounded-[2.5rem] border border-otter-400/20 bg-gradient-to-br from-otter-900/90 via-otter-950/90 to-slate-950/90 p-8 shadow-[0_40px_120px_-50px_rgba(0,0,0,0.65)] lg:grid-cols-[1.6fr_1fr] xl:p-10">
        <div className="flex flex-col justify-between gap-6">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-otter-500/15 border border-otter-400/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-otter-300">
            <Sparkles className="h-3.5 w-3.5" />
            Sanitizer actif
          </div>
          <div>
            <h1 className="text-5xl font-bold tracking-tight text-otter-50 sm:text-6xl">
              PresentOtter
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-otter-200/80 sm:text-xl">
              Enregistre ton écran, annote en direct, et exporte sans jamais laisser de
              clés API ou secrets dans la vidéo.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { title: 'Capture', description: 'Écran, fenêtre ou région + audio système et micro.' },
              { title: 'Annotations', description: 'Dessin, flèches, texte, spotlight et pas à pas.' },
              { title: 'Sanitizer', description: 'Détection automatique de secrets et masquage.' },
              { title: 'Export', description: 'MP4, WebM ou GIF avec presets optimisés.' }
            ].map((item) => (
              <div key={item.title} className="rounded-3xl border border-white/5 bg-white/5 p-5 text-sm text-otter-100 shadow-[0_20px_40px_-25px_rgba(13,46,65,0.8)]">
                <p className="font-semibold text-otter-50">{item.title}</p>
                <p className="mt-2 text-otter-200/80">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-otter-500/5 p-6 text-otter-100 shadow-[0_30px_80px_-40px_rgba(8,29,42,0.72)]">
          <p className="text-sm uppercase tracking-[0.3em] text-otter-300">Fonctionnalités clés</p>
          <div className="mt-6 space-y-4">
            {[
              { icon: Video, title: 'Capture flexible', text: 'Écran entier, région ou fenêtre dédiée.' },
              { icon: PenTool, title: 'Annotations live', text: 'Dessin, texte, flèches et spotlight.' },
              { icon: ShieldCheck, title: 'Sanitizer', text: 'Masque automatiquement secrets et tokens.' },
              { icon: ArrowUpRight, title: 'Export intelligent', text: 'MP4 / WebM / GIF optimisé.' }
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex items-start gap-4 rounded-3xl bg-white/5 p-4">
                <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-otter-500/15 text-otter-100">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-otter-50">{title}</p>
                  <p className="mt-1 text-sm text-otter-200/80">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Source picker */}
        <div className="flex flex-col gap-4 rounded-3xl border border-otter-400/20 bg-white/5 p-6 shadow-[0_30px_80px_-45px_rgba(8,29,42,0.7)]">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-otter-300">
            Source de capture
          </h2>
          <SourceSelector selected={source} onSelect={setSource} />
        </div>

        <aside className="rounded-3xl border border-otter-400/20 bg-white/5 p-6 shadow-[0_30px_80px_-45px_rgba(8,29,42,0.7)]">
          <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-otter-300">Raccourcis clavier</h2>
          <div className="mt-5 space-y-3">
            {[
              { keys: 'F9', label: 'Démarrer / mettre en pause' },
              { keys: 'F10', label: 'Arrêter' },
              { keys: 'F8', label: 'Activer le mode annotation' },
              { keys: 'Escape', label: 'Effacer les annotations' },
              { keys: 'F12', label: 'Capture rapide' }
            ].map(({ keys, label }) => (
              <div key={keys} className="flex items-center justify-between rounded-2xl bg-otter-900/40 px-4 py-3 text-sm text-otter-100">
                <span>{label}</span>
                <kbd className="rounded bg-white/[0.06] border border-white/[0.1] px-2 py-1 font-mono text-[11px] text-otter-100">{keys}</kbd>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-otter-200/70">
            Lance l’enregistrement et découvre toutes les fonctionnalités disponibles.
          </p>
        </aside>
      </div>

      {/* Big record button — centered, glowing */}
      <div className="flex flex-col items-center gap-5 pt-2">
        <RecordButton onStart={handleStart} onStop={() => undefined} />
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-medium text-otter-100">Démarrer l'enregistrement</p>
          <p className="text-xs text-otter-200/50">
            Raccourci : <kbd className="rounded bg-white/[0.06] border border-white/[0.1] px-1.5 py-0.5 font-mono text-[10px]">F9</kbd>
          </p>
        </div>
      </div>

      {/* Feature overview */}
      <section className="grid gap-6 pt-8 lg:grid-cols-[1.5fr_1fr]">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: Video,
              title: 'Capture flexible',
              description: 'Écran entier, fenêtre ou région, avec audio système et micro.'
            },
            {
              icon: PenTool,
              title: 'Annotations live',
              description: 'Dessins, flèches, textes, spotlight et compteurs d’étapes en direct.'
            },
            {
              icon: ShieldCheck,
              title: 'Sanitizer automatique',
              description: 'Masque les clés API, JWT, tokens et secrets avant export.'
            },
            {
              icon: ArrowUpRight,
              title: 'Export intelligent',
              description: 'MP4, WebM ou GIF optimisé avec contrôle de qualité et watermark.'
            }
          ].map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-3xl border border-otter-400/30 bg-white/5 p-5 shadow-[0_30px_80px_-50px_rgba(8,29,42,0.8)]">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-otter-500/10 text-otter-100">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-otter-50">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-otter-200/80">{description}</p>
            </div>
          ))}
        </div>

        <aside className="rounded-3xl border border-otter-400/30 bg-otter-500/5 p-5 shadow-[0_30px_80px_-50px_rgba(8,29,42,0.8)]">
          <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-otter-300">Raccourcis clavier</h2>
          <div className="mt-6 space-y-4">
            {[
              { keys: 'F9', label: 'Démarrer / mettre en pause' },
              { keys: 'F10', label: 'Arrêter' },
              { keys: 'F8', label: 'Activer le mode annotation' },
              { keys: 'Escape', label: 'Effacer les annotations' },
              { keys: 'F12', label: 'Capture rapide' }
            ].map(({ keys, label }) => (
              <div key={keys} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm text-otter-100">
                <span>{label}</span>
                <kbd className="rounded bg-white/[0.06] border border-white/[0.1] px-2 py-1 font-mono text-[11px] text-otter-100">{keys}</kbd>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-5 text-otter-200/70">
            Ces fonctionnalités sont disponibles pendant l’enregistrement et l’export. Commence par choisir une source et appuie sur démarrer.
          </p>
        </aside>
      </section>

      {/* Big record button — centered, glowing */}
      <div className="flex flex-col items-center gap-5 pt-6">
        <RecordButton onStart={handleStart} onStop={() => undefined} />
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-medium text-otter-100">Démarrer l'enregistrement</p>
          <p className="text-xs text-otter-200/50">
            Raccourci : <kbd className="rounded bg-white/[0.06] border border-white/[0.1] px-1.5 py-0.5 font-mono text-[10px]">F9</kbd>
          </p>
        </div>
      </div>
    </section>
  )
}
