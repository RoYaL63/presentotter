import { useEffect, useRef, useState } from 'react'
import { Square } from 'lucide-react'

/**
 * RegionRecorder — the tiny always-on-top control bar that records a single
 * screen region to WebM (ShareX-style).
 *
 * It runs the whole pipeline itself: getUserMedia on the chosen display's
 * desktop source (full device resolution), draws each frame cropped to the
 * region onto an offscreen canvas, and feeds canvas.captureStream() +
 * system-audio tracks into a MediaRecorder. The control window is placed
 * OUTSIDE the region by main, so it is cropped away and never appears in
 * the recording.
 *
 * Stop is triggered by the button, the Escape key, or main (hotkey toggle
 * via onRecorderStop). On stop we save through the existing recordingSaveBlob
 * IPC and report recorderDone(path) so main can notify + restore Home.
 */

type Phase = 'starting' | 'recording' | 'saving' | 'error'

interface Config {
  sourceId: string
  rect: { x: number; y: number; width: number; height: number }
  fps: number
}

interface DesktopVideoConstraints {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
    minFrameRate?: number
    maxFrameRate?: number
  }
}

async function acquire(
  sourceId: string,
  fps: number,
  withAudio: boolean
): Promise<MediaStream> {
  const video: DesktopVideoConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      minFrameRate: Math.min(24, fps),
      maxFrameRate: fps
    }
  }
  const audio = withAudio
    ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
    : false
  return navigator.mediaDevices.getUserMedia({
    video: video as unknown as MediaTrackConstraints,
    audio: audio === false ? false : (audio as unknown as MediaTrackConstraints)
  })
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function RegionRecorder(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('starting')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const srcStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const stoppingRef = useRef(false)

  const cleanup = (): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    rafRef.current = null
    timerRef.current = null
    srcStreamRef.current?.getTracks().forEach((t) => t.stop())
  }

  const stop = (): void => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    const rec = recorderRef.current
    if (rec !== null && rec.state !== 'inactive') {
      setPhase('saving')
      rec.stop()
    } else {
      window.api?.recorderDone(null)
    }
  }

  useEffect(() => {
    let alive = true

    const begin = async () => {
      const cfg = (await window.api?.recorderGetConfig()) as Config | null
      if (cfg === null || cfg === undefined) {
        setError('Configuration introuvable')
        setPhase('error')
        return
      }
      let stream: MediaStream
      try {
        stream = await acquire(cfg.sourceId, cfg.fps, true)
      } catch {
        // System audio refused (no loopback device, etc.) — retry mute.
        try {
          stream = await acquire(cfg.sourceId, cfg.fps, false)
        } catch (err) {
          if (!alive) return
          setError(err instanceof Error ? err.message : String(err))
          setPhase('error')
          return
        }
      }
      if (!alive) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      srcStreamRef.current = stream

      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      try {
        await video.play()
      } catch {
        /* autoplay should be fine for a muted element */
      }

      const { x, y, width, height } = cfg.rect
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(2, width)
      canvas.height = Math.max(2, height)
      const ctx = canvas.getContext('2d')
      if (ctx === null) {
        setError('Canvas indisponible')
        setPhase('error')
        return
      }

      const draw = (): void => {
        ctx.drawImage(video, x, y, width, height, 0, 0, width, height)
        rafRef.current = requestAnimationFrame(draw)
      }
      draw() // prime one frame before captureStream

      const outStream = canvas.captureStream(cfg.fps)
      for (const track of stream.getAudioTracks()) outStream.addTrack(track)

      const candidates = [
        'video/webm; codecs="vp9,opus"',
        'video/webm; codecs="vp8,opus"',
        'video/webm'
      ]
      const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? ''
      const rec = new MediaRecorder(outStream, {
        mimeType: mime,
        videoBitsPerSecond: 6_000_000
      })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        cleanup()
        try {
          const blob = new Blob(chunksRef.current, { type: 'video/webm' })
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const out = await window.api?.recordingSaveBlob({
            bytes,
            suggestedName: `PresentOtter-zone ${ts}.webm`
          })
          window.api?.recorderDone(out?.path ?? null)
        } catch (err) {
          console.error('[recorder] save failed:', err)
          window.api?.recorderDone(null)
        }
      }
      rec.start(1000)
      recorderRef.current = rec

      // Stop automatically if the OS ends the screen share.
      const vt = stream.getVideoTracks()[0]
      vt?.addEventListener('ended', () => stop())

      if (!alive) return
      setPhase('recording')
      const startedAt = performance.now()
      timerRef.current = window.setInterval(() => {
        setElapsed(performance.now() - startedAt)
      }, 250)
    }

    void begin()
    const offStop = window.api?.onRecorderStop(() => stop())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
      if (offStop !== undefined) offStop()
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="flex w-full items-center gap-3 rounded-full border border-[#ff8b7b55] bg-[#0A1F1Bf2] px-4 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
        {phase === 'error' ? (
          <>
            <span className="flex-1 truncate text-[12px] text-[#ff8b7b]">
              {error ?? 'Erreur'}
            </span>
            <button
              type="button"
              onClick={() => window.api?.recorderDone(null)}
              className="rounded-full bg-[#ff8b7b] px-3 py-1 text-[12px] font-bold text-[#2a0d08]"
            >
              Fermer
            </button>
          </>
        ) : (
          <>
            <span className="relative flex h-3 w-3 flex-shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff5a5a] opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#ff5a5a]" />
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-[#E7F3ED]">
              {phase === 'saving' ? 'Sauvegarde…' : fmt(elapsed)}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={stop}
              disabled={phase === 'saving'}
              title="Arrêter (Échap)"
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#ff8b7b] to-[#f86a57] px-3.5 py-1.5 text-[12px] font-bold text-white shadow-[0_4px_14px_rgba(248,106,87,0.4)] transition hover:brightness-110 disabled:opacity-60"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Arrêter
            </button>
          </>
        )}
      </div>
    </div>
  )
}
