import { useEffect, useState } from 'react'
import { Check, Copy, FolderOpen, Save, SaveAll } from 'lucide-react'

/**
 * CaptureEditor — the dedicated pop-up window that opens when the user
 * clicks the "capture copied" notification.
 *
 * Phase 1 (here): show the capture, copy / save / save-as / reveal.
 * Phase 2 will layer a drawing canvas (pencil/rect/arrow/text/highlight)
 * and a crop tool on top, flattening annotations into the exported PNG.
 */

interface EditorImage {
  dataUrl: string
  width: number
  height: number
}

function toBase64(dataUrl: string): string {
  return dataUrl.split(',')[1] ?? ''
}

export function CaptureEditor(): React.ReactElement {
  const [img, setImg] = useState<EditorImage | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api?.editorGetImage().then((i) => {
      if (i !== null) setImg(i)
    })
    const off = window.api?.onEditorLoadImage((i) => {
      if (i !== null) {
        setImg(i)
        setSavedPath(null)
        setCopied(false)
      }
    })
    return off
  }, [])

  const copy = async () => {
    if (img === null) return
    await window.api?.editorCopyImage(toBase64(img.dataUrl))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  const save = async () => {
    if (img === null) return
    const p = (await window.api?.editorSaveImage(toBase64(img.dataUrl))) ?? null
    if (p !== null) setSavedPath(p)
  }
  const saveAs = async () => {
    if (img === null) return
    const p = (await window.api?.editorSaveImageAs(toBase64(img.dataUrl))) ?? null
    if (p !== null) setSavedPath(p)
  }
  const reveal = () => {
    if (savedPath !== null) void window.api?.editorReveal(savedPath)
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0A1F1B] text-[#E7F3ED]">
      {/* Top action bar */}
      <header className="flex items-center justify-between gap-3 border-b border-[#3BE6C022] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-base">🦦</span>
          <span className="font-semibold tracking-tight">
            Éditeur de capture
          </span>
          {img !== null && (
            <span className="ml-2 rounded-full bg-[#3BE6C015] px-2.5 py-0.5 font-mono text-[11px] text-[#3BE6C0]">
              {img.width} × {img.height}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <EditorButton onClick={copy} primary>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Copié' : 'Copier'}</span>
          </EditorButton>
          <EditorButton onClick={save}>
            <Save className="h-4 w-4" />
            <span>Enregistrer</span>
          </EditorButton>
          <EditorButton onClick={saveAs}>
            <SaveAll className="h-4 w-4" />
            <span>Enregistrer sous</span>
          </EditorButton>
        </div>
      </header>

      {/* Canvas area */}
      <main className="relative flex flex-1 items-center justify-center overflow-auto p-6">
        {img === null ? (
          <p className="text-sm text-[#E7F3ED]/60">Chargement de la capture…</p>
        ) : (
          <img
            src={img.dataUrl}
            alt="Capture"
            className="max-h-full max-w-full rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.55)] ring-1 ring-[#3BE6C022]"
            style={{ imageRendering: 'auto' }}
          />
        )}
      </main>

      {/* Status / saved toast */}
      {savedPath !== null && (
        <footer className="flex items-center justify-between gap-3 border-t border-[#3BE6C022] bg-[#3BE6C00d] px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-[#3BE6C0]">
            <Check className="h-4 w-4" />
            Enregistré : <span className="font-mono text-[12px] text-[#E7F3ED]/80">{savedPath}</span>
          </span>
          <button
            type="button"
            onClick={reveal}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#3BE6C01a] px-3 py-1 text-[12px] font-semibold text-[#3BE6C0] transition hover:bg-[#3BE6C033]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Afficher dans le dossier
          </button>
        </footer>
      )}
    </div>
  )
}

interface EditorButtonProps {
  onClick: () => void
  children: React.ReactNode
  primary?: boolean
}

function EditorButton({
  onClick,
  children,
  primary = false
}: EditorButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
        primary
          ? 'bg-gradient-to-br from-[#2BD9AC] to-[#0FA587] text-[#06231D] shadow-[0_4px_16px_rgba(43,217,172,0.35)] hover:from-[#3BE6C0] hover:to-[#0FA587]'
          : 'bg-[#3BE6C014] text-[#E7F3ED] ring-1 ring-[#3BE6C022] hover:bg-[#3BE6C024]'
      }`}
    >
      {children}
    </button>
  )
}
