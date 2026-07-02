import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  ShieldCheck,
  X
} from 'lucide-react'
import { SanitizerAnalyzer, PATTERNS } from '../sanitizer'
import { RiverWave } from './components/RiverWave'
import type { DetectedZone } from '@interfaces'

/**
 * Quick-access sanitizer popup invoked from the toolbar shield button.
 *
 * Use case during a screen share:
 * 1. User is about to paste a token / .env line / curl example on screen.
 * 2. They open this popup, paste the text, see whether the Gardien would
 *    flag it — no need to actually risk leaking it to the meeting.
 *
 * The analyzer runs entirely in-renderer (no IPC, no network) — safe.
 */
interface SanitizerPopupProps {
  onClose(): void
}

export function SanitizerPopup({ onClose }: SanitizerPopupProps) {
  const [text, setText] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const analyzer = useMemo(() => new SanitizerAnalyzer(), [])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Autofocus + Escape closes the popup
  useEffect(() => {
    textareaRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const zones: DetectedZone[] = useMemo(() => {
    if (text.trim().length === 0) return []
    return analyzer.analyzeText(text)
  }, [text, analyzer])

  // Build the redacted version on the fly so the user can copy it back
  // and paste a safe version instead of the raw one.
  const redactedText = useMemo(() => {
    if (text.trim().length === 0) return ''
    let out = text
    for (const p of PATTERNS) {
      p.regex.lastIndex = 0
      out = out.replace(p.regex, p.replacement)
    }
    return out
  }, [text])

  const isSafe = text.trim().length > 0 && zones.length === 0

  const handlePaste = async (): Promise<void> => {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip.length > 0) setText(clip)
    } catch (err) {
      console.warn('[sanitizer-popup] clipboard read failed:', err)
    }
  }

  const handleCopyRedacted = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(redactedText)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch (err) {
      console.warn('[sanitizer-popup] clipboard write failed:', err)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sanitizer"
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      style={{ background: 'rgba(5, 10, 20, 0.4)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="glass glass-shine w-full max-w-xl rounded-2xl p-5 animate-fade-in-up">
        <RiverWave topClass="rounded-t-2xl" />
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter">
              <ShieldCheck className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-otter-50">Sanitizer · vérification rapide</h2>
              <p className="text-xs text-otter-200/60">
                Colle un texte pour voir s'il contient un secret détecté par Gardien.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-otter-200/80 transition-all hover:bg-red-500/15 hover:text-red-200"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePaste()}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-otter-100 ring-1 ring-white/[0.12] transition hover:bg-white/[0.10]"
            title="Coller le contenu du presse-papier"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            Coller depuis le presse-papier
          </button>
          {text.length > 0 && (
            <button
              type="button"
              onClick={() => setText('')}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-otter-200/80 ring-1 ring-white/[0.10] transition hover:bg-white/[0.08]"
              title="Vider la zone de texte"
            >
              Vider
            </button>
          )}
          <span className="ml-auto text-[10px] text-otter-200/50">
            {text.length} caractère{text.length > 1 ? 's' : ''}
          </span>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Colle ici une ligne de code, un curl, un .env, une clé... rien ne sort de ce poste."
          rows={7}
          className="mt-2 w-full rounded-xl border border-white/[0.1] bg-deep-950/60 backdrop-blur-xl px-4 py-3 text-sm font-mono text-otter-50 outline-none placeholder:text-otter-200/30 focus:border-otter-400/50"
        />

        {/* Verdict */}
        <div className="mt-4">
          {text.trim().length === 0 ? (
            <p className="text-xs text-otter-200/50">En attente d'un texte à analyser…</p>
          ) : isSafe ? (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-300" strokeWidth={2} />
              <div>
                <p className="font-semibold">Aucun secret détecté</p>
                <p className="mt-0.5 text-xs text-emerald-200/70">
                  Gardien n'a rien matché parmi ses {PATTERNS.length} patterns. Reste vigilant pour les
                  formats personnalisés non reconnus.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-red-400/40 bg-red-500/15 p-3 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-300" strokeWidth={2} />
              <div className="flex-1">
                <p className="font-semibold">
                  {zones.length} secret{zones.length > 1 ? 's' : ''} détecté{zones.length > 1 ? 's' : ''}
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {zones.map((z, i) => (
                    <li
                      key={`${z.pattern}-${i}`}
                      className="flex items-center justify-between rounded-lg bg-red-950/30 px-2.5 py-1.5 font-mono"
                    >
                      <span>
                        <span className="text-red-200">{z.type}</span>
                        <span className="ml-2 text-red-300/60">{z.pattern}</span>
                      </span>
                      <span className="text-red-200/70">
                        confiance {(z.confidence * 100).toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-red-200/70">
                  Ne partage pas ce texte tel quel pendant ton écran. Copie la version
                  redactée ci-dessous, elle est sûre à coller en clair.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Redacted version + copy back. Hidden when nothing was matched. */}
        {zones.length > 0 && (
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-deep-950/40 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-otter-200/70">
                Version redactée
              </span>
              <button
                type="button"
                onClick={() => void handleCopyRedacted()}
                className="inline-flex items-center gap-1.5 rounded-full bg-coral-500/85 px-3 py-1 text-[11px] font-bold text-white shadow-glow-coral transition hover:bg-coral-500"
              >
                {copyState === 'copied' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Copié
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copier
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-deep-950/70 px-3 py-2 font-mono text-[11px] leading-snug text-otter-100/90">
              {redactedText}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
