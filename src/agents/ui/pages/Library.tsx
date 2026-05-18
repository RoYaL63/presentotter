import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
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

  // Hydrate le store depuis la DB de l'orchestrator au montage
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
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Bibliothèque</h1>
        <p className="text-slate-400">
          {recordings.length} enregistrement{recordings.length > 1 ? 's' : ''}
        </p>
      </header>

      {recordings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/40 p-12 text-center text-slate-400">
          Aucun enregistrement pour l'instant.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {recordings.map((recording) => (
            <li
              key={recording.id}
              className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-700 bg-slate-800/60 p-4"
            >
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
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                  />
                ) : (
                  <p className="text-base font-semibold text-slate-100">{recording.name}</p>
                )}
                <p className="text-xs text-slate-400">
                  {formatDuration(recording.duration)} · {formatDate(recording.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startRename(recording.id, recording.name)}
                  className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-600"
                >
                  <Pencil className="h-3 w-3" />
                  <span>Renommer</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(recording.id)}
                  className="flex items-center gap-1 rounded-lg bg-red-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Supprimer</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
