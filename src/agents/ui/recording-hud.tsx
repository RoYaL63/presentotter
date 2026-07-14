import { useEffect, useRef, useState } from 'react'

/**
 * Shared recording HUD widgets used by both recorders (RecordingPanel for
 * full screen / window, RegionRecorder for a region):
 *
 *   - CountdownOverlay — 3-2-1 between the click on "Démarrer" and the
 *     actual MediaRecorder start, so the user has time to set the stage.
 *     Escape (or the button) cancels; clicking the digit skips straight
 *     to recording.
 *   - AudioLevelMeter — live level bar driven by a WebAudio AnalyserNode,
 *     so the user SEES that sound is being captured: mic check before
 *     recording, and the actually-recorded mix while recording.
 *   - useMicPreviewStream — opens the mic only while its meter is on
 *     screen, releases it as soon as the toggle/phase changes.
 *   - formatBytes — human-readable size of the chunks captured so far.
 *
 * Perf: the meter writes levels straight to DOM styles inside its own rAF
 * loop — zero React re-renders per frame — and each meter owns one tiny
 * analyser (fftSize 256), negligible next to the video pipeline. Loops
 * stop themselves on unmount / stream change, so idle cost is zero.
 */

// ---------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------

interface CountdownOverlayProps {
  /** Seconds before onDone fires. */
  seconds?: number
  onDone(): void
  onCancel(): void
}

export function CountdownOverlay({
  seconds = 3,
  onDone,
  onCancel
}: CountdownOverlayProps): React.ReactElement {
  const [left, setLeft] = useState(seconds)
  // Freshest callbacks without restarting the interval.
  const doneRef = useRef(onDone)
  const cancelRef = useRef(onCancel)
  doneRef.current = onDone
  cancelRef.current = onCancel
  const firedRef = useRef(false)

  useEffect(() => {
    firedRef.current = false
    setLeft(seconds)
    const id = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          window.clearInterval(id)
          // Fire outside the state updater (updaters must stay pure), and
          // only once even if StrictMode re-runs the effect.
          if (!firedRef.current) {
            firedRef.current = true
            window.setTimeout(() => doneRef.current(), 120)
          }
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [seconds])

  // Escape cancels — capture phase so the shortcut wins over any parent
  // key handling in the host window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const skip = (): void => {
    if (firedRef.current) return
    firedRef.current = true
    doneRef.current()
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#04211c]/70 backdrop-blur-[2px]"
    >
      <button
        type="button"
        onClick={skip}
        title="Démarrer tout de suite"
        aria-label={`Démarrage dans ${left} secondes — cliquer pour démarrer tout de suite`}
        className="flex h-28 w-28 items-center justify-center rounded-full bg-[#0A1F1B]/80 ring-4 ring-[#3BE6C0]/60 transition hover:ring-[#3BE6C0]"
      >
        <span
          key={left}
          className="animate-countdown-pop font-display text-6xl font-bold tabular-nums text-[#3BE6C0]"
        >
          {Math.max(1, left)}
        </span>
      </button>
      <span className="text-sm font-semibold text-white/90">
        L&apos;enregistrement démarre…
      </span>
      <button
        type="button"
        onClick={() => cancelRef.current()}
        className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80 ring-1 ring-white/20 transition hover:bg-white/20 hover:text-white"
      >
        Annuler (Échap)
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------
// Audio level meter
// ---------------------------------------------------------------------

interface AudioLevelMeterProps {
  /** Stream whose FIRST audio track is metered. null → "Aucun son". */
  stream: MediaStream | null
  label: string
  /** 'light' for the glass RecordingPanel, 'dark' for the RegionRecorder. */
  tone?: 'light' | 'dark'
  className?: string
}

export function AudioLevelMeter({
  stream,
  label,
  tone = 'light',
  className = ''
}: AudioLevelMeterProps): React.ReactElement {
  const fillRef = useRef<HTMLDivElement | null>(null)
  const peakRef = useRef<HTMLDivElement | null>(null)
  const [hasAudio, setHasAudio] = useState(false)

  useEffect(() => {
    const track = stream?.getAudioTracks()[0]
    if (stream === null || track === undefined) {
      setHasAudio(false)
      if (fillRef.current !== null) fillRef.current.style.transform = 'scaleX(0)'
      return
    }
    setHasAudio(true)
    const audioCtx = new AudioContext()
    // Autoplay policy can spawn the context 'suspended' when no user
    // gesture is on record — the meter would then sit flat at zero.
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {})
    const source = audioCtx.createMediaStreamSource(new MediaStream([track]))
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)

    let raf = 0
    let smooth = 0
    let peak = 0
    let peakAt = 0
    const tick = (): void => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buf.length)
      // Perceptual mapping: −50 dB → 0, 0 dB → 1. A straight linear RMS
      // barely moves for normal speech; the dB curve makes the bar live.
      const db = 20 * Math.log10(Math.max(rms, 1e-5))
      const level = Math.min(1, Math.max(0, (db + 50) / 50))
      // Fast attack, slow release — reads like a real VU needle.
      smooth = level > smooth ? level : smooth * 0.88
      const now = performance.now()
      if (smooth >= peak || now - peakAt > 1200) {
        peak = smooth
        peakAt = now
      }
      if (fillRef.current !== null) {
        fillRef.current.style.transform = `scaleX(${smooth.toFixed(3)})`
        fillRef.current.style.backgroundColor =
          smooth > 0.92 ? '#ff5a5a' : smooth > 0.75 ? '#ffd166' : '#2BD9AC'
      }
      if (peakRef.current !== null) {
        peakRef.current.style.left = `${(peak * 100).toFixed(1)}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      void audioCtx.close().catch(() => {})
    }
  }, [stream])

  const labelCls =
    tone === 'dark'
      ? 'text-[10px] font-semibold uppercase tracking-wide text-[#7fbfb0]'
      : 'text-[10px] font-semibold uppercase tracking-[0.14em] text-sea-700/70'
  const trackCls =
    tone === 'dark' ? 'bg-white/10 ring-1 ring-white/10' : 'bg-sea-900/10 ring-1 ring-sea-900/10'
  const mutedCls = tone === 'dark' ? 'text-[#5b8a7e]' : 'text-sea-700/50'

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span className={`${labelCls} whitespace-nowrap`}>{label}</span>
      {hasAudio ? (
        <div
          className={`relative h-1.5 min-w-[64px] flex-1 overflow-hidden rounded-full ${trackCls}`}
          role="meter"
          aria-label={`Niveau ${label}`}
        >
          <div
            ref={fillRef}
            className="h-full w-full origin-left rounded-full"
            style={{ transform: 'scaleX(0)', backgroundColor: '#2BD9AC' }}
          />
          <div
            ref={peakRef}
            className="absolute top-0 h-full w-0.5 bg-white/80"
            style={{ left: '0%' }}
          />
        </div>
      ) : (
        <span className={`text-[10px] ${mutedCls}`}>aucun son</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Mic preview stream
// ---------------------------------------------------------------------

/**
 * Opens the microphone while `enabled`, releases it otherwise. Used by the
 * pre-recording mic check meter — the LED only stays on while the meter is
 * actually on screen.
 */
export function useMicPreviewStream(enabled: boolean): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let acquired: MediaStream | null = null
    void navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((s) => {
        if (cancelled) {
          for (const t of s.getTracks()) t.stop()
          return
        }
        acquired = s
        setStream(s)
      })
      .catch(() => {
        /* mic refused — the meter shows "aucun son" */
      })
    return () => {
      cancelled = true
      if (acquired !== null) for (const t of acquired.getTracks()) t.stop()
      setStream(null)
    }
  }, [enabled])

  return stream
}

// ---------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------

/** "873 Ko", "12,4 Mo", "1,25 Go" — for the live captured-size readout. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 Ko'
  const kb = n / 1024
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} Ko`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} Mo`
  return `${(mb / 1024).toFixed(2).replace('.', ',')} Go`
}
