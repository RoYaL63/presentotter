import { useEffect, useRef, useState } from 'react'
import { Circle, Mic, Monitor, Pause, Play, Square, Video } from 'lucide-react'

/**
 * RegionRecorder — the always-on-top panel that records a single screen
 * region to WebM (ShareX-style), positioned by main OUTSIDE the region so
 * it is cropped out of the capture.
 *
 * Flow: setup (live preview + toggles for system audio / mic / webcam) →
 * Démarrer → recording (with Pause / Reprendre) → Arrêter → save.
 *
 * Everything runs in this renderer: getUserMedia on the chosen display's
 * desktop source, an offscreen-style canvas that crops each frame to the
 * region (and composites a webcam PiP), then canvas.captureStream() + the
 * chosen audio tracks into a MediaRecorder.
 */

type Phase = 'setup' | 'recording' | 'paused' | 'saving' | 'error'

interface Config {
  sourceId: string
  rect: { x: number; y: number; width: number; height: number }
  fps: number
}

interface DesktopConstraints {
  mandatory: { chromeMediaSource: 'desktop'; chromeMediaSourceId: string }
}

async function acquireScreenVideo(
  sourceId: string,
  fps: number
): Promise<MediaStream> {
  const video = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      minFrameRate: Math.min(24, fps),
      maxFrameRate: fps
    }
  }
  return navigator.mediaDevices.getUserMedia({
    video: video as unknown as MediaTrackConstraints,
    audio: false
  })
}

/** Desktop (loopback) audio. Requested with video then the video track is
 *  dropped, because Electron only hands out desktop audio alongside video. */
async function acquireSystemAudio(sourceId: string): Promise<MediaStream> {
  const c: DesktopConstraints = {
    mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
  }
  const s = await navigator.mediaDevices.getUserMedia({
    video: c as unknown as MediaTrackConstraints,
    audio: c as unknown as MediaTrackConstraints
  })
  s.getVideoTracks().forEach((t) => t.stop())
  return s
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function RegionRecorder(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('setup')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sysAudio, setSysAudio] = useState(true)
  const [mic, setMic] = useState(false)
  const [webcam, setWebcam] = useState(false)

  const cfgRef = useRef<Config | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null)
  const webcamOnRef = useRef(false)

  const screenStreamRef = useRef<MediaStream | null>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const sysAudioStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const accRef = useRef(0)
  const segStartRef = useRef(0)
  const phaseRef = useRef<Phase>('setup')
  const doneRef = useRef(false)

  const setPhaseSafe = (p: Phase): void => {
    phaseRef.current = p
    setPhase(p)
  }

  const stopStreams = (): void => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop())
    sysAudioStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
  }

  const fullCleanup = (): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    rafRef.current = null
    timerRef.current = null
    stopStreams()
    if (audioCtxRef.current !== null) {
      void audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }

  const finish = (path: string | null): void => {
    if (doneRef.current) return
    doneRef.current = true
    fullCleanup()
    window.api?.recorderDone(path)
  }

  // ---- Setup: acquire screen, start preview draw loop ----
  useEffect(() => {
    let alive = true
    const begin = async (): Promise<void> => {
      const cfg = (await window.api?.recorderGetConfig()) as Config | null
      if (cfg === null || cfg === undefined) {
        setError('Configuration introuvable')
        setPhaseSafe('error')
        return
      }
      cfgRef.current = cfg
      let stream: MediaStream
      try {
        stream = await acquireScreenVideo(cfg.sourceId, cfg.fps)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setPhaseSafe('error')
        return
      }
      if (!alive) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      screenStreamRef.current = stream
      const v = document.createElement('video')
      v.srcObject = stream
      v.muted = true
      try {
        await v.play()
      } catch {
        /* muted autoplay is allowed */
      }
      screenVideoRef.current = v

      const canvas = canvasRef.current
      if (canvas === null) return
      canvas.width = Math.max(2, cfg.rect.width)
      canvas.height = Math.max(2, cfg.rect.height)
      const ctx = canvas.getContext('2d')
      if (ctx === null) {
        setError('Canvas indisponible')
        setPhaseSafe('error')
        return
      }

      const r = cfg.rect
      const draw = (): void => {
        const sv = screenVideoRef.current
        if (sv !== null && sv.readyState >= 2) {
          ctx.drawImage(sv, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height)
        }
        const wv = webcamVideoRef.current
        if (webcamOnRef.current && wv !== null && wv.readyState >= 2) {
          const pipW = Math.round(canvas.width * 0.26)
          const ratio =
            wv.videoWidth > 0 ? wv.videoHeight / wv.videoWidth : 0.5625
          const pipH = Math.round(pipW * ratio)
          const m = Math.round(canvas.width * 0.02)
          const px = canvas.width - pipW - m
          const py = canvas.height - pipH - m
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(px, py, pipW, pipH, Math.round(pipW * 0.06))
          ctx.clip()
          ctx.drawImage(wv, px, py, pipW, pipH)
          ctx.restore()
          ctx.save()
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.lineWidth = Math.max(2, canvas.width / 400)
          ctx.beginPath()
          ctx.roundRect(px, py, pipW, pipH, Math.round(pipW * 0.06))
          ctx.stroke()
          ctx.restore()
        }
        rafRef.current = requestAnimationFrame(draw)
      }
      draw()
    }
    void begin()

    const offStop = window.api?.onRecorderStop(() => {
      if (phaseRef.current === 'setup') finish(null)
      else void stopRecording()
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (phaseRef.current === 'setup') finish(null)
        else void stopRecording()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
      if (offStop !== undefined) offStop()
      fullCleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Webcam toggle: acquire / release live so the preview updates ----
  useEffect(() => {
    let alive = true
    if (webcam) {
      void navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then((s) => {
          if (!alive) {
            s.getTracks().forEach((t) => t.stop())
            return
          }
          webcamStreamRef.current = s
          const v = document.createElement('video')
          v.srcObject = s
          v.muted = true
          void v.play().catch(() => {})
          webcamVideoRef.current = v
          webcamOnRef.current = true
        })
        .catch(() => {
          setWebcam(false)
        })
    } else {
      webcamOnRef.current = false
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop())
      webcamStreamRef.current = null
      webcamVideoRef.current = null
    }
    return () => {
      alive = false
    }
  }, [webcam])

  const startTimer = (): void => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setElapsed(accRef.current + (performance.now() - segStartRef.current))
    }, 250)
  }

  const startRecording = async (): Promise<void> => {
    const cfg = cfgRef.current
    const canvas = canvasRef.current
    if (cfg === null || canvas === null) return
    const audioTracks: MediaStreamTrack[] = []
    if (sysAudio) {
      try {
        const s = await acquireSystemAudio(cfg.sourceId)
        sysAudioStreamRef.current = s
        audioTracks.push(...s.getAudioTracks())
      } catch {
        /* no loopback device — keep going muted */
      }
    }
    if (mic) {
      try {
        const m = await navigator.mediaDevices.getUserMedia({ audio: true })
        micStreamRef.current = m
        audioTracks.push(...m.getAudioTracks())
      } catch {
        /* mic refused */
      }
    }
    const out = canvas.captureStream(cfg.fps)
    // Merge every audio source into ONE track via WebAudio — MediaRecorder
    // only reliably records a single audio track, so simply addTrack-ing
    // both system + mic would drop one of them.
    if (audioTracks.length > 0) {
      const audioCtx = new AudioContext()
      const dest = audioCtx.createMediaStreamDestination()
      for (const t of audioTracks) {
        audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest)
      }
      for (const t of dest.stream.getAudioTracks()) out.addTrack(t)
      audioCtxRef.current = audioCtx
    }

    const candidates = [
      'video/webm; codecs="vp9,opus"',
      'video/webm; codecs="vp8,opus"',
      'video/webm'
    ]
    const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? ''
    const rec = new MediaRecorder(out, {
      mimeType: mime,
      videoBitsPerSecond: 6_000_000
    })
    chunksRef.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = async () => {
      try {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const res = await window.api?.recordingSaveBlob({
          bytes,
          suggestedName: `PresentOtter-zone ${ts}.webm`
        })
        finish(res?.path ?? null)
      } catch (err) {
        console.error('[recorder] save failed:', err)
        finish(null)
      }
    }
    rec.start(1000)
    recorderRef.current = rec
    accRef.current = 0
    segStartRef.current = performance.now()
    setElapsed(0)
    startTimer()
    setPhaseSafe('recording')
  }

  const togglePause = (): void => {
    const rec = recorderRef.current
    if (rec === null) return
    if (rec.state === 'recording') {
      rec.pause()
      accRef.current += performance.now() - segStartRef.current
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      timerRef.current = null
      setPhaseSafe('paused')
    } else if (rec.state === 'paused') {
      rec.resume()
      segStartRef.current = performance.now()
      startTimer()
      setPhaseSafe('recording')
    }
  }

  const stopRecording = async (): Promise<void> => {
    const rec = recorderRef.current
    if (rec !== null && rec.state !== 'inactive') {
      setPhaseSafe('saving')
      rec.stop()
    } else {
      finish(null)
    }
  }

  const recording = phase === 'recording' || phase === 'paused'

  return (
    <div className="flex h-screen w-screen flex-col gap-2.5 rounded-2xl border border-[#3BE6C033] bg-[#0A1F1Bf2] p-3 text-[#E7F3ED] shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
      <div className="flex items-center gap-2">
        <span className="text-sm">🦦</span>
        <span className="text-sm font-semibold tracking-tight">
          Enregistrer une zone
        </span>
        {recording && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-sm tabular-nums">
            <span className="relative flex h-2.5 w-2.5">
              {phase === 'recording' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff5a5a] opacity-75" />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#ff5a5a]" />
            </span>
            {fmt(elapsed)}
          </span>
        )}
      </div>

      {/* Live preview (the actual capture canvas) */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/50 ring-1 ring-white/10">
        {phase === 'error' ? (
          <p className="px-3 text-center text-[12px] text-[#ff8b7b]">{error}</p>
        ) : (
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full object-contain"
          />
        )}
        {phase === 'paused' && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-bold tracking-wide text-[#E7F3ED]">
            EN PAUSE
          </span>
        )}
      </div>

      {phase === 'error' ? (
        <button
          type="button"
          onClick={() => finish(null)}
          className="rounded-full bg-[#ff8b7b] px-3 py-2 text-[13px] font-bold text-[#2a0d08]"
        >
          Fermer
        </button>
      ) : phase === 'setup' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <ToggleRow
              icon={Monitor}
              label="Son du système"
              on={sysAudio}
              onClick={() => setSysAudio((v) => !v)}
            />
            <ToggleRow
              icon={Mic}
              label="Microphone"
              on={mic}
              onClick={() => setMic((v) => !v)}
            />
            <ToggleRow
              icon={Video}
              label="Webcam (incrustée)"
              on={webcam}
              onClick={() => setWebcam((v) => !v)}
            />
          </div>
          <button
            type="button"
            onClick={() => void startRecording()}
            className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#ff8b7b] to-[#f86a57] px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(248,106,87,0.4)] transition hover:brightness-110"
          >
            <Circle className="h-4 w-4 fill-current" />
            Démarrer l&apos;enregistrement
          </button>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePause}
            disabled={phase === 'saving'}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#3BE6C016] px-3 py-2.5 text-[13px] font-semibold text-[#E7F3ED] ring-1 ring-[#3BE6C033] transition hover:bg-[#3BE6C026] disabled:opacity-50"
          >
            {phase === 'paused' ? (
              <>
                <Play className="h-4 w-4" /> Reprendre
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" /> Pause
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void stopRecording()}
            disabled={phase === 'saving'}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#ff8b7b] to-[#f86a57] px-3 py-2.5 text-[13px] font-bold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            {phase === 'saving' ? 'Sauvegarde…' : 'Arrêter'}
          </button>
        </div>
      )}
    </div>
  )
}

interface ToggleRowProps {
  icon: typeof Mic
  label: string
  on: boolean
  onClick: () => void
}

function ToggleRow({ icon: Icon, label, on, onClick }: ToggleRowProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.07]"
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-[#3BE6C0]" strokeWidth={1.9} />
      <span className="flex-1 text-[13px] font-medium">{label}</span>
      <span
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
          on ? 'bg-[#2BD9AC]' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            on ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}
