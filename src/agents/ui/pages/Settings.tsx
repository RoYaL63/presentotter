import { useState } from 'react'
import type { CaptureConfig, ExportFormat } from '@interfaces'

export function Settings() {
  const [fps, setFps] = useState<CaptureConfig['fps']>(30)
  const [format, setFormat] = useState<ExportFormat>('mp4')

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Paramètres</h1>
        <p className="text-slate-400">Configure les valeurs par défaut de l'application.</p>
      </header>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-slate-800/60 p-6">
        <h2 className="text-lg font-semibold text-slate-100">Capture</h2>
        <div className="flex flex-col gap-2">
          <label htmlFor="fps" className="text-sm font-medium text-slate-300">
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
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-otter-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {value} fps
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-slate-800/60 p-6">
        <h2 className="text-lg font-semibold text-slate-100">Export</h2>
        <div className="flex flex-col gap-2">
          <label htmlFor="format" className="text-sm font-medium text-slate-300">
            Format par défaut
          </label>
          <select
            id="format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="mp4">MP4</option>
            <option value="webm">WebM</option>
            <option value="gif">GIF</option>
          </select>
        </div>
      </div>
    </section>
  )
}
