import { useCallback, useEffect, useState } from 'react'
import {
  FileVideo,
  FolderOpen,
  Pencil,
  RefreshCw,
  Scissors,
  Trash2
} from 'lucide-react'

interface Recording {
  path: string
  name: string
  ext: string
  sizeBytes: number
  mtimeMs: number
  folder: 'recordings' | 'edits'
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${bytes} o`
}

function formatDate(mtimeMs: number): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(mtimeMs))
  } catch {
    return new Date(mtimeMs).toISOString()
  }
}

/** Strip the extension for the rename input's initial value. */
function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

export function Library() {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    const list = (await window.api?.recordingsList()) ?? []
    setRecordings(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openEditor = (path: string): void => {
    window.api?.videoEditorOpen(path)
  }

  const reveal = (path: string): void => {
    void window.api?.recordingRevealInFolder(path)
  }

  const startRename = (rec: Recording): void => {
    setEditingPath(rec.path)
    setDraftName(baseName(rec.name))
  }

  const commitRename = async (rec: Recording): Promise<void> => {
    const trimmed = draftName.trim()
    setEditingPath(null)
    if (trimmed.length === 0 || trimmed === baseName(rec.name)) return
    const newPath = await window.api?.recordingsRename(rec.path, trimmed)
    if (newPath !== null && newPath !== undefined) await refresh()
  }

  const handleDelete = async (rec: Recording): Promise<void> => {
    const ok = await window.api?.recordingsDelete(rec.path)
    if (ok === true) {
      setRecordings((prev) => prev.filter((r) => r.path !== rec.path))
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8 lg:p-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-4xl font-bold tracking-tight text-otter-50">Bibliothèque</h1>
          <p className="text-base text-otter-200/70">
            {loading
              ? 'Lecture du dossier…'
              : recordings.length === 0
                ? 'Tes enregistrements apparaîtront ici.'
                : `${recordings.length} enregistrement${recordings.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-otter-100 transition hover:bg-white/[0.1]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          Actualiser
        </button>
      </header>

      {!loading && recordings.length === 0 ? (
        <div className="glass relative flex flex-col items-center justify-center gap-4 rounded-2xl p-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]">
            <FileVideo className="h-7 w-7 text-otter-200/50" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-base font-medium text-otter-100">Aucun enregistrement</p>
            <p className="mt-1 text-sm text-otter-200/50">
              Lance ta première capture depuis l&apos;accueil.
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {recordings.map((rec) => (
            <li
              key={rec.path}
              className="glass glass-interactive group flex flex-wrap items-center gap-4 rounded-2xl p-4"
            >
              {/* Format badge / thumbnail slot */}
              <div className="relative flex h-14 w-20 items-center justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-br from-deep-900 to-deep-950">
                <FileVideo className="h-6 w-6 text-otter-300/60" strokeWidth={1.5} />
                <span className="absolute bottom-1 right-1 rounded bg-otter-700/80 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-otter-50 backdrop-blur-sm">
                  {rec.ext}
                </span>
              </div>

              {/* Name + meta */}
              <div className="min-w-[200px] flex-1">
                {editingPath === rec.path ? (
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => void commitRename(rec)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(rec)
                      if (e.key === 'Escape') setEditingPath(null)
                    }}
                    autoFocus
                    className="w-full rounded-lg border border-otter-400/40 bg-deep-950/50 px-3 py-1.5 text-sm text-otter-50 outline-none backdrop-blur-xl focus:border-otter-300"
                  />
                ) : (
                  <p className="flex items-center gap-2 text-base font-semibold text-otter-50">
                    {baseName(rec.name)}
                    {rec.folder === 'edits' && (
                      <span className="rounded-full bg-otter-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-otter-300">
                        Montage
                      </span>
                    )}
                  </p>
                )}
                <p className="mt-0.5 flex items-center gap-2 text-xs text-otter-200/60">
                  <span>{formatDate(rec.mtimeMs)}</span>
                  <span aria-hidden>•</span>
                  <span className="font-mono tabular-nums">{formatSize(rec.sizeBytes)}</span>
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 opacity-70 transition-opacity duration-200 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => openEditor(rec.path)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-otter-400/30 bg-otter-500/15 px-3 py-2 text-sm font-semibold text-otter-100 transition hover:bg-otter-500/25 hover:text-otter-50"
                  aria-label={`Éditer ${rec.name}`}
                >
                  <Scissors className="h-4 w-4" strokeWidth={1.75} /> Éditer
                </button>
                <button
                  type="button"
                  onClick={() => reveal(rec.path)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-otter-200/80 transition-all hover:bg-white/[0.1] hover:text-otter-50"
                  aria-label={`Ouvrir le dossier de ${rec.name}`}
                  title="Ouvrir dans l'explorateur"
                >
                  <FolderOpen className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => startRename(rec)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-otter-200/80 transition-all hover:bg-white/[0.1] hover:text-otter-50"
                  aria-label={`Renommer ${rec.name}`}
                  title="Renommer"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(rec)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-red-300/80 transition-all hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-200"
                  aria-label={`Supprimer ${rec.name}`}
                  title="Mettre à la corbeille"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
