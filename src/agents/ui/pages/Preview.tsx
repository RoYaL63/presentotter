import { Download, ShieldCheck } from 'lucide-react'
import { VideoPreview } from '../components/VideoPreview'
import { useNavStore } from '../stores/useNavStore'

export function Preview() {
  const navigate = useNavStore((s) => s.navigate)

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Aperçu</h1>
        <p className="text-slate-400">Vérifie ton enregistrement avant l'export.</p>
      </header>

      <VideoPreview label="Lecture vidéo" />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          <ShieldCheck className="h-4 w-4" />
          <span>Sanitize</span>
        </button>

        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-otter-600 px-4 py-2 text-sm font-medium text-white hover:bg-otter-500"
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
