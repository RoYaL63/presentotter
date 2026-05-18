import { useState } from 'react'
import { Film, Video } from 'lucide-react'
import type { CaptureConfig, ExportFormat } from '@interfaces'

export function Settings() {
  const [fps, setFps] = useState<CaptureConfig['fps']>(30)
  const [format, setFormat] = useState<ExportFormat>('mp4')

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8 lg:p-12">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-4xl font-bold tracking-tight text-otter-50">Paramètres</h1>
        <p className="text-base text-otter-200/70">
          Configure les valeurs par défaut de l'application.
        </p>
      </header>

      {/* Capture section */}
      <div className="glass glass-shine flex flex-col gap-5 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-otter-500/15 border border-otter-400/30 text-otter-300">
            <Video className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="text-lg font-semibold text-otter-50">Capture</h2>
        </div>

        <div className="flex flex-col gap-2.5">
          <label htmlFor="fps" className="text-xs font-semibold uppercase tracking-[0.15em] text-otter-300">
            Images par seconde
          </label>
          <div id="fps" className="flex gap-2">
            {[30, 60].map((value) => {
              const active = fps === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFps(value as CaptureConfig['fps'])}
                  className={`relative flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200
                    ${active
                      ? 'bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter ring-1 ring-otter-300/40'
                      : 'bg-white/[0.04] border border-white/[0.08] text-otter-200/80 hover:bg-white/[0.08] hover:text-otter-50'}
                  `}
                >
                  {active && (
                    <span className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/30 to-transparent pointer-events-none" aria-hidden />
                  )}
                  <span className="relative">{value} fps</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Export section */}
      <div className="glass glass-shine flex flex-col gap-5 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fur-500/15 border border-fur-400/30 text-fur-300">
            <Film className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="text-lg font-semibold text-otter-50">Export</h2>
        </div>

        <div className="flex flex-col gap-2.5">
          <label htmlFor="format" className="text-xs font-semibold uppercase tracking-[0.15em] text-otter-300">
            Format par défaut
          </label>
          <select
            id="format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="rounded-xl border border-white/[0.1] bg-white/[0.04] backdrop-blur-xl px-4 py-3 text-sm text-otter-50 outline-none transition-colors hover:bg-white/[0.08] focus:border-otter-400/50"
          >
            <option value="mp4" className="bg-deep-900">MP4 — universel</option>
            <option value="webm" className="bg-deep-900">WebM — web optimisé</option>
            <option value="gif" className="bg-deep-900">GIF — social</option>
          </select>
        </div>
      </div>

      {/* About / version */}
      <div className="glass-subtle flex items-center justify-between rounded-2xl p-5">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-2xl" aria-hidden>🦦</span>
          <div>
            <p className="font-semibold text-otter-100">PresentOtter</p>
            <p className="text-xs text-otter-200/60">v0.1.0-alpha · OTTERWISE Solutions</p>
          </div>
        </div>
        <span className="rounded-full bg-otter-500/15 border border-otter-400/30 px-3 py-1 text-xs font-medium uppercase tracking-wider text-otter-300">
          Pre-release
        </span>
      </div>
    </section>
  )
}
