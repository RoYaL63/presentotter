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
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Aperçu</h1>
        <p className="text-slate-400">Vérifie ton enregistrement avant l'export.</p>
      </header>

      <VideoPreview label="Lecture vidéo" />

      {report !== null && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm font-medium text-slate-200">
            Analyse Gardien : {report.zonesDetected.length} zone(s) détectée(s)
          </p>
          {report.patternMatches.length > 0 && (
            <ul className="mt-2 text-xs text-slate-400">
              {report.patternMatches.map((m) => (
                <li key={m.pattern}>
                  • <span className="font-mono">{m.pattern}</span> : {m.count}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isExporting && (
        <div className="rounded-lg border border-otter-700 bg-otter-700/20 p-4">
          <p className="text-sm font-medium text-slate-100">
            Export en cours… {progress.toFixed(0)}%
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full bg-otter-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {exportError !== null && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-200">
          Export échoué : {exportError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSanitize}
          disabled={sanitizing}
          className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" />
          <span>{sanitizing ? 'Analyse…' : 'Sanitize'}</span>
        </button>

        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        >
          <option value="mp4">MP4</option>
          <option value="webm">WebM</option>
          <option value="gif">GIF</option>
        </select>

        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 rounded-lg bg-otter-600 px-4 py-2 text-sm font-medium text-white hover:bg-otter-500 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          <span>Exporter</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('library')}
          className="ml-auto rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-100"
        >
          Aller à la bibliothèque
        </button>
      </div>
    </section>
  )
}
