import { useEffect, useRef, useState } from 'react'
import {
  Circle,
  Image as ImageIcon,
  Maximize2,
  Mic,
  Minus,
  Monitor,
  MonitorUp,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Square,
  Video,
  X
} from 'lucide-react'
import {
  dataUrlToBitmap,
  fileToBackgroundDataUrl,
  startWebcamEffects,
  type BlurIntensity,
  type CamBgMode,
  type WebcamEffectsProcessor,
  type WebcamEffectsRefs
} from './webcam-effects'
import { useToolSettingsStore } from './stores/useToolSettingsStore'

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
 *
 * The webcam PiP can have its background blurred / replaced by an image /
 * filled with a solid color via MediaPipe selfie segmentation (see
 * webcam-effects.ts). The panel itself is draggable (header), can collapse
 * to a compact pill, and can hop to the next display so it never sits on
 * the screen being filmed.
 */

type Phase = 'setup' | 'recording' | 'paused' | 'saving' | 'error'

const PANEL_W = 360
const PANEL_H = 480
const COMPACT_W = 214
const COMPACT_H = 56

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

// Inline drag regions for the frameless window. The header drags the whole
// panel; every control opts back out with `no-drag` so clicks register.
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NODRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function RegionRecorder(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('setup')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sysAudio, setSysAudio] = useState(true)
  const [mic, setMic] = useState(false)
  const [webcam, setWebcam] = useState(false)
  const [compact, setCompact] = useState(false)

  // Webcam background preference comes from the PERSISTENT store, so the
  // user's blur / image / color choice is always there on relaunch and can
  // still be changed live during a recording (it writes straight back).
  const webcamCfg = useToolSettingsStore((s) => s.webcam)
  const setWebcamCfg = useToolSettingsStore((s) => s.setWebcam)

  const cfgRef = useRef<Config | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null)
  // The PiP source actually drawn into the capture: the raw webcam video
  // when no effect is active, or the effects-processor canvas otherwise.
  const pipSourceRef = useRef<HTMLVideoElement | HTMLCanvasElement | null>(null)
  const webcamOnRef = useRef(false)
  const effectsRef = useRef<WebcamEffectsProcessor | null>(null)

  // Refs the webcam-effects rAF loop reads every frame — mutating these
  // updates the effect live without restarting the processor.
  const modeRef = useRef<CamBgMode>(webcamCfg.bgMode)
  const blurRef = useRef<BlurIntensity>(webcamCfg.blur)
  const imageBitmapRef = useRef<ImageBitmap | null>(null)
  const colorRef = useRef<string>(webcamCfg.color)
  const effectsRefs: WebcamEffectsRefs = {
    modeRef,
    blurRef,
    imageBitmapRef,
    colorRef
  }

  const screenStreamRef = useRef<MediaStream | null>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const sysAudioStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  // The combined capture stream (canvas video + merged audio). Kept alive
  // across stop/restart so "recommencer" / "couper" can spin a fresh
  // MediaRecorder on it without re-acquiring screen/audio.
  const outStreamRef = useRef<MediaStream | null>(null)
  // What the next rec.onstop should do with the captured chunks.
  const pendingActionRef = useRef<
    'finish' | 'discard-close' | 'discard-restart' | 'save-restart'
  >('finish')
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

  // Keep the effect refs in lock-step with the persistent settings, so a
  // change (here or from the Outils page, via the shared store) applies to
  // the live effects loop on the very next frame.
  useEffect(() => {
    modeRef.current = webcamCfg.bgMode
  }, [webcamCfg.bgMode])
  useEffect(() => {
    blurRef.current = webcamCfg.blur
  }, [webcamCfg.blur])
  useEffect(() => {
    colorRef.current = webcamCfg.color
  }, [webcamCfg.color])
  useEffect(() => {
    let alive = true
    if (webcamCfg.imageDataUrl === null) {
      imageBitmapRef.current = null
      return
    }
    void dataUrlToBitmap(webcamCfg.imageDataUrl)
      .then((bmp) => {
        if (!alive) {
          bmp.close()
          return
        }
        imageBitmapRef.current = bmp
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [webcamCfg.imageDataUrl])

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
    effectsRef.current?.stop()
    effectsRef.current = null
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
        const src = pipSourceRef.current
        const ready =
          src instanceof HTMLCanvasElement
            ? src.width > 0 && src.height > 0
            : src !== null && src.readyState >= 2
        if (webcamOnRef.current && src !== null && ready) {
          const pipW = Math.round(canvas.width * 0.26)
          const srcW =
            src instanceof HTMLCanvasElement ? src.width : src.videoWidth
          const srcH =
            src instanceof HTMLCanvasElement ? src.height : src.videoHeight
          const ratio = srcW > 0 ? srcH / srcW : 0.5625
          const pipH = Math.round(pipW * ratio)
          const m = Math.round(canvas.width * 0.02)
          const px = canvas.width - pipW - m
          const py = canvas.height - pipH - m
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(px, py, pipW, pipH, Math.round(pipW * 0.06))
          ctx.clip()
          ctx.drawImage(src, px, py, pipW, pipH)
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
  }, [])

  // ---- Webcam toggle: acquire / release live so the preview updates ----
  useEffect(() => {
    let alive = true
    if (webcam) {
      void navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(async (s) => {
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
          // Always route the webcam through the effects processor: when the
          // mode is 'none' it just mirrors the frame, so toggling a blur /
          // image / color background later is instant (no stream restart).
          try {
            const proc = await startWebcamEffects(v, effectsRefs)
            if (!alive) {
              proc.stop()
              return
            }
            effectsRef.current = proc
            pipSourceRef.current = proc.canvas
          } catch {
            // Effects failed to init (no GPU, model missing) — fall back to
            // the raw video so the webcam still works, just without bg fx.
            pipSourceRef.current = v
          }
          webcamOnRef.current = true
        })
        .catch(() => {
          setWebcam(false)
        })
    } else {
      webcamOnRef.current = false
      effectsRef.current?.stop()
      effectsRef.current = null
      pipSourceRef.current = null
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop())
      webcamStreamRef.current = null
      webcamVideoRef.current = null
    }
    return () => {
      alive = false
    }
  }, [webcam])

  const onPickBgImage = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = e.target.files?.[0]
    if (file === undefined) return
    try {
      const dataUrl = await fileToBackgroundDataUrl(file)
      // Persist the image + switch to it; the imageDataUrl effect decodes
      // it into the bitmap ref the effects loop reads.
      setWebcamCfg({ imageDataUrl: dataUrl, imageName: file.name, bgMode: 'image' })
    } catch {
      /* unreadable image — ignore */
    } finally {
      e.target.value = ''
    }
  }

  const startTimer = (): void => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setElapsed(accRef.current + (performance.now() - segStartRef.current))
    }, 250)
  }

  /** Write a set of recorded chunks to disk. Returns the saved path (or
   *  null on empty/failed save). Does NOT touch streams or window state —
   *  the caller decides whether to finish or restart afterwards. */
  const saveChunks = async (chunks: Blob[]): Promise<string | null> => {
    try {
      const blob = new Blob(chunks, { type: 'video/webm' })
      if (blob.size === 0) return null
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const res = await window.api?.recordingSaveBlob({
        bytes,
        suggestedName: `PresentOtter-zone ${ts}.webm`
      })
      return res?.path ?? null
    } catch (err) {
      console.error('[recorder] save failed:', err)
      return null
    }
  }

  /** Spin a fresh MediaRecorder on the (already merged) output stream and
   *  begin a new segment. The screen/audio/webcam streams stay untouched,
   *  so this is the engine behind "recommencer" and "couper". */
  const beginSegment = (out: MediaStream): void => {
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
      const action = pendingActionRef.current
      pendingActionRef.current = 'finish'
      if (action === 'discard-close') {
        finish(null)
        return
      }
      if (action === 'discard-restart') {
        restartSegment()
        return
      }
      // save then close, or save then restart
      const chunks = chunksRef.current
      if (action === 'save-restart') {
        // Restart first (resets chunksRef) so the gap between clips is
        // minimal, then persist the segment we just captured.
        restartSegment()
        void saveChunks(chunks)
        return
      }
      finish(await saveChunks(chunks))
    }
    rec.start(1000)
    recorderRef.current = rec
    accRef.current = 0
    segStartRef.current = performance.now()
    setElapsed(0)
    startTimer()
    setPhaseSafe('recording')
  }

  /** Restart recording with the exact same settings. Reuses the live
   *  output stream when present; otherwise falls back to a full start. */
  const restartSegment = (): void => {
    if (outStreamRef.current !== null) {
      beginSegment(outStreamRef.current)
    } else {
      void startRecording()
    }
  }

  const startRecording = async (): Promise<void> => {
    const cfg = cfgRef.current
    const canvas = canvasRef.current
    if (cfg === null || canvas === null) return
    // Acquire screen audio + mic + merge once; subsequent segments reuse
    // the same combined stream.
    if (outStreamRef.current === null) {
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
      outStreamRef.current = out
    }
    beginSegment(outStreamRef.current)
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
      pendingActionRef.current = 'finish'
      setPhaseSafe('saving')
      rec.stop()
    } else {
      finish(null)
    }
  }

  /** ✕ — drop the recording (no save) and close the panel. In setup there
   *  is nothing to stop, so it just closes. */
  const cancelRecording = (): void => {
    const rec = recorderRef.current
    if (rec !== null && rec.state !== 'inactive') {
      pendingActionRef.current = 'discard-close'
      setPhaseSafe('saving')
      rec.stop()
    } else {
      finish(null)
    }
  }

  /** Recommencer — throw away the current take and immediately start a
   *  fresh one with the same settings. */
  const restartRecording = (): void => {
    const rec = recorderRef.current
    if (rec !== null && rec.state !== 'inactive') {
      pendingActionRef.current = 'discard-restart'
      rec.stop()
    } else {
      void startRecording()
    }
  }

  /** Couper — save the current take as its own clip, then keep rolling on
   *  a new clip with the same settings. */
  const cutRecording = (): void => {
    const rec = recorderRef.current
    if (rec !== null && rec.state !== 'inactive') {
      pendingActionRef.current = 'save-restart'
      rec.stop()
    }
  }

  const toggleCompact = (): void => {
    const next = !compact
    setCompact(next)
    window.api?.recorderSetSize(
      next ? COMPACT_W : PANEL_W,
      next ? COMPACT_H : PANEL_H
    )
  }

  const recording = phase === 'recording' || phase === 'paused'

  // ---- Compact pill: timer + restore + (stop while recording) ----
  if (compact) {
    return (
      <div
        style={DRAG}
        className="flex h-screen w-screen items-center gap-2 rounded-full border border-[#3BE6C033] bg-[#0A1F1Bf2] px-3 text-[#E7F3ED] shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
      >
        <span className="text-sm">🦦</span>
        {recording ? (
          <span className="flex items-center gap-1.5 font-mono text-[13px] tabular-nums">
            <span className="relative flex h-2.5 w-2.5">
              {phase === 'recording' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff5a5a] opacity-75" />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#ff5a5a]" />
            </span>
            {fmt(elapsed)}
          </span>
        ) : (
          <span className="text-[12px] font-medium opacity-80">Prêt</span>
        )}
        <div className="ml-auto flex items-center gap-1" style={NODRAG}>
          {recording && (
            <button
              type="button"
              onClick={() => void stopRecording()}
              title="Arrêter"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#ff8b7b] to-[#f86a57] text-white"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleCompact}
            title="Agrandir"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3BE6C016] text-[#3BE6C0] ring-1 ring-[#3BE6C033] hover:bg-[#3BE6C026]"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancelRecording}
            title={recording ? 'Annuler (sans sauvegarder)' : 'Fermer'}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff8b7b]/15 text-[#ffb1a4] hover:bg-[#ff8b7b]/30 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col gap-2.5 rounded-2xl border border-[#3BE6C033] bg-[#0A1F1Bf2] p-3 text-[#E7F3ED] shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
      <div className="flex items-center gap-2" style={DRAG}>
        <span className="text-sm">🦦</span>
        <span className="text-sm font-semibold tracking-tight">
          Enregistrer une zone
        </span>
        {recording && (
          <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
            <span className="relative flex h-2.5 w-2.5">
              {phase === 'recording' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff5a5a] opacity-75" />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#ff5a5a]" />
            </span>
            {fmt(elapsed)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1" style={NODRAG}>
          <button
            type="button"
            onClick={() => window.api?.recorderCycleDisplay()}
            title="Déplacer vers l'écran suivant"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[#9fd6c9] hover:bg-white/10 hover:text-white"
          >
            <MonitorUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleCompact}
            title="Réduire"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[#9fd6c9] hover:bg-white/10 hover:text-white"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={cancelRecording}
            title={recording ? 'Annuler (sans sauvegarder)' : 'Fermer'}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[#ffb1a4] hover:bg-[#ff8b7b]/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
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
          {webcam && (
            <WebcamBgControls
              camBg={webcamCfg.bgMode}
              setCamBg={(m) => setWebcamCfg({ bgMode: m })}
              blurLevel={webcamCfg.blur}
              setBlurLevel={(b) => setWebcamCfg({ blur: b })}
              bgColor={webcamCfg.color}
              setBgColor={(c) => setWebcamCfg({ color: c })}
              bgImageName={webcamCfg.imageName}
              onPickBgImage={onPickBgImage}
            />
          )}
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
        <>
          {webcam && (
            <WebcamBgControls
              camBg={webcamCfg.bgMode}
              setCamBg={(m) => setWebcamCfg({ bgMode: m })}
              blurLevel={webcamCfg.blur}
              setBlurLevel={(b) => setWebcamCfg({ blur: b })}
              bgColor={webcamCfg.color}
              setBgColor={(c) => setWebcamCfg({ color: c })}
              bgImageName={webcamCfg.imageName}
              onPickBgImage={onPickBgImage}
            />
          )}
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={restartRecording}
              disabled={phase === 'saving'}
              title="Jeter cette prise et recommencer avec les mêmes réglages"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-2 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Recommencer
            </button>
            <button
              type="button"
              onClick={cutRecording}
              disabled={phase === 'saving'}
              title="Sauvegarder ce clip et repartir aussitôt avec les mêmes réglages"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-2 text-[12px] font-semibold text-[#cfe9e1] transition hover:bg-white/[0.1] disabled:opacity-50"
            >
              <Scissors className="h-3.5 w-3.5" /> Couper
            </button>
          </div>
        </>
      )}
    </div>
  )
}

interface WebcamBgControlsProps {
  camBg: CamBgMode
  setCamBg: (m: CamBgMode) => void
  blurLevel: BlurIntensity
  setBlurLevel: (b: BlurIntensity) => void
  bgColor: string
  setBgColor: (c: string) => void
  bgImageName: string | null
  onPickBgImage: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/** Webcam background picker — none / blur / image / color, with the
 *  sub-options for the active mode. Mutates the refs the effects loop reads
 *  (via the parent's state→ref sync) so changes apply live. */
function WebcamBgControls({
  camBg,
  setCamBg,
  blurLevel,
  setBlurLevel,
  bgColor,
  setBgColor,
  bgImageName,
  onPickBgImage
}: WebcamBgControlsProps): React.ReactElement {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const modes: Array<{ id: CamBgMode; label: string; icon: typeof Video }> = [
    { id: 'none', label: 'Aucun', icon: Video },
    { id: 'blur', label: 'Flou', icon: Sparkles },
    { id: 'image', label: 'Image', icon: ImageIcon },
    { id: 'color', label: 'Couleur', icon: Palette }
  ]
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-white/[0.04] p-2">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[#7fbfb0]">
        Fond webcam
      </span>
      <div className="grid grid-cols-4 gap-1">
        {modes.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id === 'image') {
                fileRef.current?.click()
                return
              }
              setCamBg(id)
            }}
            className={`flex flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition ${
              camBg === id
                ? 'bg-[#2BD9AC] text-[#04211c]'
                : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {camBg === 'blur' && (
        <div className="flex gap-1">
          {(['light', 'medium', 'strong'] as BlurIntensity[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBlurLevel(b)}
              className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                blurLevel === b
                  ? 'bg-[#3BE6C0] text-[#04211c]'
                  : 'bg-white/[0.05] text-[#cfe9e1] hover:bg-white/[0.1]'
              }`}
            >
              {b === 'light' ? 'Léger' : b === 'medium' ? 'Moyen' : 'Fort'}
            </button>
          ))}
        </div>
      )}

      {camBg === 'color' && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="color"
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            className="h-6 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
          />
          <span className="text-[11px] text-[#cfe9e1]">{bgColor}</span>
        </div>
      )}

      {camBg === 'image' && bgImageName !== null && (
        <span className="truncate px-1 text-[11px] text-[#9fd6c9]">
          {bgImageName}
        </span>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={(e) => void onPickBgImage(e)}
        className="hidden"
      />
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
