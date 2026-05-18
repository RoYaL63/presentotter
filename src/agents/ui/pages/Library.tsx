import { useEffect, useState } from 'react'
import { FileVideo, Pencil, Trash2 } from 'lucide-react'
import { useLibraryStore } from '../stores/useLibraryStore'
import { orchestrator } from '../orchestrator'

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  } catch {
    return date.toString()
  }
}

export function Library() {
  const recordings = useLibraryStore((s) => s.recordings)
  const addRecording = useLibraryStore((s) => s.addRecording)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    const entries = orchestrator.getLibraryEntries()
    for (const entry of entries) {
      addRecording(entry)
    }
  }, [addRecording])

  const startRename = (id: string, currentName: string) => {
    setEditingId(id)
    setDraftName(currentName)
  }

  const commitRename = (id: string) => {
    const trimmed = draftName.trim()
    if (trimmed.length > 0) {
      orchestrator.renameLibraryEntry(id, trimmed)
    }
    setEditingId(null)
    setDraftName('')
  }

  const handleDelete = (id: string) => {
    orchestrator.deleteLibraryEntry(id)
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8 lg:p-12">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-4xl font-bold tracking-tight text-otter-50">Bibliothèque</h1>
        <p className="text-base text-otter-200/70">
          {recordings.length === 0
            ? 'Tes enregistrements apparaîtront ici.'
            : `${recordings.length} enregistrement${recordings.length > 1 ? 's' : ''}`}
        </p>
      </header>

      {recordings.length === 0 ? (
        <div className="glass relative flex flex-col items-center justify-center gap-4 rounded-2xl p-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.05] border border-white/[0.08]">
            <FileVideo className="h-7 w-7 text-otter-200/50" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-base font-medium text-otter-100">Aucun enregistrement</p>
            <p className="mt-1 text-sm text-otter-200/50">
              Lance ta première capture depuis l'accueil.
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {recordings.map((recording) => (
            <li
              key={recording.id}
              className="glass glass-interactive group flex flex-wrap items-center gap-4 rounded-2xl p-4"
            >
              {/* Thumbnail / format badge */}
              <div className="relative flex h-14 w-20 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-deep-900 to-deep-950 border border-white/[0.06]">
                <FileVideo className="h-6 w-6 text-otter-300/60" strokeWidth={1.5} />
                {recording.format && (
                  <span className="absolute bottom-1 right-1 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-otter-50 bg-otter-700/80 backdrop-blur-sm">
                    {recording.format}
                  </span>
                )}
              </div>

              {/* Name + meta */}
              <div className="flex-1 min-w-[200px]">
                {editingId === recording.id ? (
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(recording.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(recording.id)
                      if (e.key === 'Escape') {
                        setEditingId(null)
                        setDraftName('')
                      }
                    }}
                    autoFocus
                    className="w-full rounded-lg border border-otter-400/40 bg-deep-950/50 backdrop-blur-xl px-3 py-1.5 text-sm text-otter-50 outline-none focus:border-otter-300"
                  />
                ) : (
                  <p className="text-base font-semibold text-otter-50">{recording.name}</p>
                )}
                <p className="mt-0.5 flex items-center gap-2 text-xs text-otter-200/60">
                  <span className="font-mono tabular-nums">{formatDuration(recording.duration)}</span>
                  <span aria-hidden>•</span>
                  <span>{formatDate(recording.createdAt)}</span>
                  {recording.sanitized && (
                    <>
                      <span aria-hidden>•</span>
                      <span className="rounded-full bg-otter-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-otter-300">
                        Sanitized
                      </span>
                    </>
                  )}
                </p>
              </div>

              {/* Actions — visible on hover for cleaner default state */}
              <div className="flex items-center gap-2 opacity-60 transition-opacity duration-200 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => startRename(recording.id, recording.name)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-otter-200/80 transition-all hover:bg-white/[0.1] hover:text-otter-50"
                  aria-label={`Renommer ${recording.name}`}
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(recording.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-red-300/80 transition-all hover:bg-red-500/15 hover:border-red-400/40 hover:text-red-200"
                  aria-label={`Supprimer ${recording.name}`}
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
