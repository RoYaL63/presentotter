import { useState } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import type { ExportConfig, ExportFormat, SanitizeReport } from '@interfaces'
import { VideoPreview } from '../components/VideoPreview'
import { useNavStore } from '../stores/useNavStore'
import { useExportStore } from '../stores/useExportStore'
import { orchestrator } from '../orchestrator'

export function Preview() {
  const navigate = useNavStore((s) => s.navigate)
  const isExporting = useExportStore((s) => s.isExporting)
  const progress = useExportStore((s) => s.progress)
  const exportError = useExportStore((s) => s.error)
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [report, setReport] = useState<SanitizeReport | null>(null)
  const [sanitizing, setSanitizing] = useState(false)

  const handleSanitize = async () => {
    const recording = orchestrator.getLastRecording()
    if (!recording) return
    setSanitizing(true)
    try {
      const r = await orchestrator.runSanitizer(recording)
      setReport(r)
    } finally {
      setSanitizing(false)
    }
  }

  const handleExport = async () => {
    const recording = orchestrator.getLastRecording()
    if (!recording) return
    const config: ExportConfig = {
      format,
      quality: 'medium',
      outputPath: `/recordings/${recording.id}.${format}`
    }
    try {
      await orchestrator.exportRecording(recording, config)
      navigate('library')
    } catch {
      // error event mis dans useExportStore via eventListeners
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8 lg:p-12">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-4xl font-bold tracking-tight text-otter-50">Aperçu</h1>
        <p className="text-base text-otter-200/70">
          Vérifie ton enregistrement, lance le sanitizer puis exporte au format de ton choix.
        </p>
      </header>

      <VideoPreview label="Lecture vidéo" />

      {/* Sanitize report panel */}
      {report !== null && (
        <div className="glass glass-shine animate-fade-in-up rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter">
              <ShieldCheck className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <p className="text-sm font-semibold text-otter-50">
                Analyse Gardien — {report.zonesDetected.length} zone{report.zonesDetected.length > 1 ? 's' : ''} détectée{report.zonesDetected.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-otter-200/60">
                {report.totalFrames} frames analysées
              </p>
            </div>
          </div>
          {report.patternMatches.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {report.patternMatches.map((m) => (
                <li
                  key={m.pattern}
                  className="flex items-center justify-between rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-xs"
                >
                  <span className="font-mono text-otter-200">{m.pattern}</span>
                  <span className="rounded-full bg-otter-500/20 px-2 py-0.5 text-otter-300 font-semibold tabular-nums">
                    {m.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Export progress */}
      {isExporting && (
        <div className="glass glass-shine animate-fade-in-up rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-otter-50">Export en cours</span>
            <span className="font-mono text-sm font-semibold text-otter-300 tabular-nums">
              {progress.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-otter-400 to-otter-300 shadow-glow-otter transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {exportError !== null && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/30 backdrop-blur-xl p-4 text-sm text-red-200">
          Export échoué : {exportError}
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSanitize}
          disabled={sanitizing}
          className="btn-glass"
        >
          <ShieldCheck className="h-4 w-4" />
          <span>{sanitizing ? 'Analyse…' : 'Sanitize'}</span>
        </button>

        <div className="flex items-center gap-2 rounded-xl bg-white/[0.05] border border-white/[0.1] px-2 py-1 backdrop-blur-xl">
          <span className="pl-2 text-xs uppercase tracking-wider text-otter-200/60">Format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="rounded-lg bg-transparent px-2 py-1.5 text-sm text-otter-50 outline-none cursor-pointer"
          >
            <option value="mp4" className="bg-deep-900">MP4</option>
            <option value="webm" className="bg-deep-900">WebM</option>
            <option value="gif" className="bg-deep-900">GIF</option>
          </select>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="btn-otter"
        >
          <Download className="h-4 w-4" />
          <span>Exporter</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('library')}
          className="ml-auto rounded-xl px-3 py-2 text-sm text-otter-200/60 transition-colors hover:text-otter-100"
        >
          → Bibliothèque
        </button>
      </div>
    </section>
  )
}
