import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  CameraOff,
  Check,
  Circle,
  FileVideo,
  FolderOpen,
  ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  RotateCcw,
  Square,
  Squircle,
  Upload,
  User,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'

/**
 * RecordingPanel — full-screen modal that lets the user:
 *
 *   1. Pick a capture source (screen or window)
 *   2. Toggle microphone + system audio
 *   3. Embed a live webcam picture-in-picture (corner / shape / size)
 *   4. Add a designer background under the screen capture
 *   5. Record + save the result as WebM (or convert to MP4 via ffmpeg)
 *
 * Composition pipeline (when webcam or background is active):
 *   screen + webcam are drawn frame-by-frame into an offscreen <canvas>
 *   sized to the screen video's source pixels. captureStream() from the
 *   canvas is what MediaRecorder consumes, so all overlays are baked
 *   into the saved file with no post-production.
 *
 * Layout:
 *   The picker is a two-column grid. The LEFT column holds the source
 *   list. The RIGHT column holds audio + webcam + background config in
 *   collapsible-but-always-visible sections, so the user never has to
 *   scroll past anything to find a setting.
 */

interface RecordingPanelProps {
  onClose(): void
}

interface SourceItem {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string | null
  appIcon: string | null
}

type Phase = 'picking' | 'preparing' | 'recording' | 'stopped' | 'saving' | 'saved'

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type WebcamShape = 'circle' | 'rounded' | 'square'
type WebcamSize = 'small' | 'medium' | 'large'
type BackgroundKind = 'none' | 'preset' | 'custom'

interface BackgroundPreset {
  id: string
  label: string
  paint(ctx: CanvasRenderingContext2D, w: number, h: number): void
}

interface ElectronDesktopConstraints {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
    maxWidth?: number
    maxHeight?: number
    minFrameRate?: number
    maxFrameRate?: number
  }
}

interface ElectronAudioConstraints {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
  }
}

/** Webcam target as a fraction of the screen's shorter edge. */
const WEBCAM_SIZE_RATIO: Record<WebcamSize, number> = {
  small: 0.11,
  medium: 0.17,
  large: 0.25
}

const WEBCAM_MARGIN_PX = 32
const WEBCAM_BORDER_PX = 6

/** Background presets. paint() is called every frame so simple
 *  gradients are cheap; image-backed ones cache an ImageBitmap. */
const BG_PRESETS: BackgroundPreset[] = [
  {
    id: 'otter-mesh',
    label: 'Otter mesh',
    paint(ctx, w, h) {
      // Radial mesh inspired by the Home background.
      const g1 = ctx.createRadialGradient(w * 0.2, h * 0.3, 0, w * 0.2, h * 0.3, w * 0.55)
      g1.addColorStop(0, '#B8E0E8')
      g1.addColorStop(1, '#E8F4F8')
      ctx.fillStyle = g1
      ctx.fillRect(0, 0, w, h)
      const g2 = ctx.createRadialGradient(w * 0.85, h * 0.75, 0, w * 0.85, h * 0.75, w * 0.5)
      g2.addColorStop(0, 'rgba(245, 230, 211, 0.85)')
      g2.addColorStop(1, 'rgba(245, 230, 211, 0)')
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, w, h)
    }
  },
  {
    id: 'aqua-wave',
    label: 'Aqua wave',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#B8E0E8')
      g.addColorStop(1, '#1B5E7B')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
  },
  {
    id: 'studio-dark',
    label: 'Studio',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#0D3548')
      g.addColorStop(1, '#07212F')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      // Soft spotlight
      const spot = ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, w * 0.6)
      spot.addColorStop(0, 'rgba(184, 224, 232, 0.18)')
      spot.addColorStop(1, 'rgba(184, 224, 232, 0)')
      ctx.fillStyle = spot
      ctx.fillRect(0, 0, w, h)
    }
  },
  {
    id: 'cream-soft',
    label: 'Cream',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#F5E6D3')
      g.addColorStop(1, '#C89E76')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
  },
  {
    id: 'coral-sunset',
    label: 'Coral sunset',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#FF8B7B')
      g.addColorStop(0.6, '#FFC857')
      g.addColorStop(1, '#F5E6D3')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
  }
]

export function RecordingPanel({ onClose }: RecordingPanelProps) {
  const [sources, setSources] = useState<SourceItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true)
  const [includeWebcam, setIncludeWebcam] = useState(false)
  const [webcamDeviceId, setWebcamDeviceId] = useState<string | null>(null)
  const [webcamDevices, setWebcamDevices] = useState<MediaDeviceInfo[]>([])
  const [webcamCorner, setWebcamCorner] = useState<Corner>('bottom-right')
  const [webcamShape, setWebcamShape] = useState<WebcamShape>('circle')
  const [webcamSize, setWebcamSize] = useState<WebcamSize>('medium')
  const [bgKind, setBgKind] = useState<BackgroundKind>('none')
  const [bgPresetId, setBgPresetId] = useState<string>(BG_PRESETS[0]?.id ?? 'otter-mesh')
  const [bgCustomDataUrl, setBgCustomDataUrl] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('picking')
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [mp4State, setMp4State] = useState<
    | { kind: 'idle' }
    | { kind: 'converting' }
    | { kind: 'done'; path: string }
    | { kind: 'error'; reason: string }
  >({ kind: 'idle' })

  // Live composer settings — refs so the rAF loop reads the freshest
  // values every frame without prop drilling.
  const cornerRef = useRef<Corner>(webcamCorner)
  const shapeRef = useRef<WebcamShape>(webcamShape)
  const sizeRef = useRef<WebcamSize>(webcamSize)
  const bgKindRef = useRef<BackgroundKind>(bgKind)
  const bgPresetIdRef = useRef<string>(bgPresetId)
  const bgCustomBitmapRef = useRef<ImageBitmap | null>(null)
  cornerRef.current = webcamCorner
  shapeRef.current = webcamShape
  sizeRef.current = webcamSize
  bgKindRef.current = bgKind
  bgPresetIdRef.current = bgPresetId

  // Stream / recorder refs
  const streamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const composerRef = useRef<Composer | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const webcamPreviewRef = useRef<HTMLVideoElement | null>(null)
  const pickerWebcamStreamRef = useRef<MediaStream | null>(null)

  // -----------------------------------------------------------------
  // Custom background — turn user-supplied image into an ImageBitmap
  // and stash it in a ref the composer can read each frame.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (bgCustomDataUrl === null) {
      bgCustomBitmapRef.current = null
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const blob = await (await fetch(bgCustomDataUrl)).blob()
        const bmp = await createImageBitmap(blob)
        if (!cancelled) bgCustomBitmapRef.current = bmp
      } catch (err) {
        console.warn('[recording] custom bg decode failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bgCustomDataUrl])

  // -----------------------------------------------------------------
  // Source enumeration
  // -----------------------------------------------------------------

  const refreshSources = useCallback(async () => {
    if (window.api === undefined) return
    setError(null)
    try {
      const list = await window.api.recordingListSources()
      setSources(list)
      if (selectedId === null && list.length > 0) {
        const firstScreen = list.find((s) => s.kind === 'screen')
        setSelectedId((firstScreen ?? list[0])?.id ?? null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [selectedId])

  const refreshWebcams = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const cams = all.filter((d) => d.kind === 'videoinput')
      setWebcamDevices(cams)
      if (webcamDeviceId === null && cams.length > 0) {
        setWebcamDeviceId(cams[0]?.deviceId ?? null)
      }
    } catch (err) {
      console.warn('[recording] enumerate webcams failed:', err)
    }
  }, [webcamDeviceId])

  useEffect(() => {
    void refreshSources()
    void refreshWebcams()
  }, [refreshSources, refreshWebcams])

  // Live webcam preview in the picker
  useEffect(() => {
    let cancelled = false
    const teardown = () => {
      if (pickerWebcamStreamRef.current !== null) {
        for (const t of pickerWebcamStreamRef.current.getTracks()) t.stop()
        pickerWebcamStreamRef.current = null
      }
      if (webcamPreviewRef.current !== null) {
        webcamPreviewRef.current.srcObject = null
      }
    }
    if (!includeWebcam || phase !== 'picking') {
      teardown()
      return
    }
    void (async () => {
      try {
        const constraint: MediaTrackConstraints =
          webcamDeviceId !== null
            ? { deviceId: { exact: webcamDeviceId }, width: 640, height: 480 }
            : { width: 640, height: 480 }
        const s = await navigator.mediaDevices.getUserMedia({ video: constraint, audio: false })
        if (cancelled) {
          for (const t of s.getTracks()) t.stop()
          return
        }
        pickerWebcamStreamRef.current = s
        if (webcamPreviewRef.current !== null) {
          webcamPreviewRef.current.srcObject = s
          void webcamPreviewRef.current.play().catch(() => {})
        }
      } catch (err) {
        console.warn('[recording] webcam preview failed:', err)
        setIncludeWebcam(false)
      }
    })()
    return () => {
      cancelled = true
      teardown()
    }
  }, [includeWebcam, webcamDeviceId, phase])

  // -----------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------

  useEffect(() => {
    return () => {
      stopAllTracks()
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      if (pickerWebcamStreamRef.current !== null) {
        for (const t of pickerWebcamStreamRef.current.getTracks()) t.stop()
        pickerWebcamStreamRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopAllTracks = () => {
    if (composerRef.current !== null) {
      composerRef.current.stop()
      composerRef.current = null
    }
    if (streamRef.current !== null) {
      for (const t of streamRef.current.getTracks()) t.stop()
      streamRef.current = null
    }
    if (screenStreamRef.current !== null) {
      for (const t of screenStreamRef.current.getTracks()) t.stop()
      screenStreamRef.current = null
    }
    if (webcamStreamRef.current !== null) {
      for (const t of webcamStreamRef.current.getTracks()) t.stop()
      webcamStreamRef.current = null
    }
    if (recorderRef.current !== null && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* already stopped */
      }
    }
  }

  // -----------------------------------------------------------------
  // Start / Stop / Save / Export
  // -----------------------------------------------------------------

  const handleStart = useCallback(async () => {
    if (selectedId === null) {
      setError('Choisis une source à enregistrer.')
      return
    }
    setError(null)
    setPhase('preparing')

    try {
      const screenStream = await acquireScreenStream(
        selectedId,
        includeSystemAudio && sources.find((s) => s.id === selectedId)?.kind === 'screen'
      )
      screenStreamRef.current = screenStream

      let webcamStream: MediaStream | null = null
      if (includeWebcam) {
        try {
          const cam: MediaTrackConstraints =
            webcamDeviceId !== null
              ? { deviceId: { exact: webcamDeviceId }, width: 1280, height: 720 }
              : { width: 1280, height: 720 }
          webcamStream = await navigator.mediaDevices.getUserMedia({ video: cam, audio: false })
          webcamStreamRef.current = webcamStream
        } catch (err) {
          console.warn('[recording] webcam denied:', err)
        }
      }

      let micStream: MediaStream | null = null
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          })
        } catch (err) {
          console.warn('[recording] mic denied:', err)
        }
      }

      // We compose if EITHER webcam is on OR background is set — both
      // need the offscreen canvas pipeline.
      const needsCompose = webcamStream !== null || bgKindRef.current !== 'none'
      let videoStreamForRecorder: MediaStream
      if (needsCompose) {
        const composer = await startComposer(screenStream, webcamStream, {
          cornerRef,
          shapeRef,
          sizeRef,
          bgKindRef,
          bgPresetIdRef,
          bgCustomBitmapRef
        })
        composerRef.current = composer
        videoStreamForRecorder = composer.stream
      } else {
        videoStreamForRecorder = new MediaStream(screenStream.getVideoTracks())
      }

      const finalStream = mixIntoFinalStream(
        videoStreamForRecorder,
        screenStream.getAudioTracks(),
        micStream?.getAudioTracks() ?? []
      )
      streamRef.current = finalStream

      if (previewRef.current !== null) {
        previewRef.current.srcObject = finalStream
        void previewRef.current.play().catch(() => {})
      }

      const candidates = [
        'video/webm; codecs="vp9,opus"',
        'video/webm; codecs="vp8,opus"',
        'video/webm'
      ]
      const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? ''
      const recorder = new MediaRecorder(finalStream, {
        mimeType: mime,
        videoBitsPerSecond: 6_000_000
      })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => setPhase('stopped')
      recorder.start(1000)
      recorderRef.current = recorder

      setPhase('recording')
      const startedAt = performance.now()
      setElapsedMs(0)
      timerRef.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAt)
      }, 250)

      const videoTrack = screenStream.getVideoTracks()[0]
      if (videoTrack !== undefined) {
        videoTrack.addEventListener('ended', () => {
          if (recorderRef.current !== null && recorderRef.current.state === 'recording') {
            recorderRef.current.stop()
          }
          stopAllTracks()
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
        })
      }
    } catch (err) {
      console.error('[recording] start failed:', err)
      setError(err instanceof Error ? err.message : String(err))
      setPhase('picking')
      stopAllTracks()
    }
  }, [
    selectedId,
    includeMic,
    includeSystemAudio,
    includeWebcam,
    webcamDeviceId,
    sources
  ])

  const handleStop = useCallback(() => {
    if (recorderRef.current !== null && recorderRef.current.state === 'recording') {
      recorderRef.current.stop()
    }
    stopAllTracks()
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (window.api === undefined) return
    setPhase('saving')
    try {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const suggested = `PresentOtter ${ts}.webm`
      const out = await window.api.recordingSaveBlob({ bytes, suggestedName: suggested })
      setSavedPath(out.path)
      setPhase('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('stopped')
    }
  }, [])

  const handleDiscard = useCallback(() => {
    chunksRef.current = []
    setPhase('picking')
    setSavedPath(null)
    setElapsedMs(0)
    setMp4State({ kind: 'idle' })
    void refreshSources()
  }, [refreshSources])

  const handleReveal = useCallback(() => {
    if (savedPath === null) return
    void window.api?.recordingRevealInFolder(savedPath)
  }, [savedPath])

  const handleExportMp4 = useCallback(async () => {
    if (savedPath === null || window.api === undefined) return
    setMp4State({ kind: 'converting' })
    const res = await window.api.recordingExportMp4(savedPath)
    if (res.ok) setMp4State({ kind: 'done', path: res.path })
    else setMp4State({ kind: 'error', reason: res.reason })
  }, [savedPath])

  const formatTime = useMemo(
    () =>
      (ms: number): string => {
        const totalSec = Math.floor(ms / 1000)
        const h = Math.floor(totalSec / 3600)
        const m = Math.floor((totalSec % 3600) / 60)
        const s = totalSec % 60
        const mm = m.toString().padStart(2, '0')
        const ss = s.toString().padStart(2, '0')
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
      },
    []
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Démarrer un enregistrement d'écran"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md"
      style={{ background: 'rgba(7, 33, 47, 0.42)' }}
    >
      <div className="otter-glass otter-aqua relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden">
        <header className="relative flex items-center justify-between border-b border-white/40 px-6 py-3">
          <div>
            <h2 className="font-display text-xl font-bold text-sea-700">
              Enregistrer l&apos;écran
            </h2>
            <p className="text-xs text-cream-800/70">
              Source, audio, webcam et fond. Tout en un seul fichier.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full p-2 text-sea-700 transition-colors hover:bg-coral-500/15 hover:text-coral-500"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="relative flex-1 overflow-hidden px-4 py-3">
          {error !== null && (
            <div
              role="alert"
              className="mb-3 rounded-2xl border border-coral-400/60 bg-coral-100/80 px-4 py-2 text-sm text-coral-700"
            >
              <strong className="font-bold">Erreur :</strong> {error}
            </div>
          )}

          {phase === 'picking' && (
            <PickerView
              sources={sources}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRefresh={refreshSources}
              includeMic={includeMic}
              onToggleMic={setIncludeMic}
              includeSystemAudio={includeSystemAudio}
              onToggleSystemAudio={setIncludeSystemAudio}
              includeWebcam={includeWebcam}
              onToggleWebcam={setIncludeWebcam}
              webcamDevices={webcamDevices}
              webcamDeviceId={webcamDeviceId}
              onSelectWebcam={setWebcamDeviceId}
              webcamCorner={webcamCorner}
              onSelectCorner={setWebcamCorner}
              webcamShape={webcamShape}
              onSelectShape={setWebcamShape}
              webcamSize={webcamSize}
              onSelectSize={setWebcamSize}
              webcamPreviewRef={webcamPreviewRef}
              bgKind={bgKind}
              onSelectBgKind={setBgKind}
              bgPresetId={bgPresetId}
              onSelectBgPreset={setBgPresetId}
              bgCustomDataUrl={bgCustomDataUrl}
              onSelectBgCustom={setBgCustomDataUrl}
            />
          )}

          {(phase === 'preparing' ||
            phase === 'recording' ||
            phase === 'stopped' ||
            phase === 'saving' ||
            phase === 'saved') && (
            <ActiveView
              phase={phase}
              elapsedMs={elapsedMs}
              formatTime={formatTime}
              previewRef={previewRef}
              savedPath={savedPath}
              webcamActive={includeWebcam}
              webcamCorner={webcamCorner}
              onCornerChange={setWebcamCorner}
              webcamShape={webcamShape}
              onShapeChange={setWebcamShape}
              webcamSize={webcamSize}
              onSizeChange={setWebcamSize}
              bgKind={bgKind}
              onBgKindChange={setBgKind}
              bgPresetId={bgPresetId}
              onBgPresetChange={setBgPresetId}
            />
          )}
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t border-white/40 bg-white/40 px-6 py-2.5 backdrop-blur-md">
          <span className="text-[11px] text-cream-800/60">
            {phase === 'picking' && '🦦 Les vidéos atterrissent dans Vidéos\\PresentOtter\\'}
            {phase === 'preparing' && 'Acquisition de la source en cours…'}
            {phase === 'recording' && (
              <span className="inline-flex items-center gap-2 text-coral-500">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inset-0 animate-glow-pulse rounded-full bg-coral-400" />
                  <span className="relative h-2 w-2 rounded-full bg-coral-500" />
                </span>
                Enregistrement en cours · {formatTime(elapsedMs)}
              </span>
            )}
            {phase === 'stopped' && 'Aperçu prêt. Sauvegarder ou recommencer ?'}
            {phase === 'saving' && 'Écriture sur le disque…'}
            {phase === 'saved' && savedPath !== null && (
              <span className="inline-flex items-center gap-2 text-kelp-500">
                <Check className="h-3.5 w-3.5" /> Sauvegardé
              </span>
            )}
          </span>

          <div className="flex items-center gap-2">
            {phase === 'picking' && (
              <>
                <button type="button" onClick={onClose} className="btn-glass">
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={selectedId === null}
                  className="btn-otter"
                >
                  <Circle className="h-4 w-4 fill-current" /> Démarrer
                </button>
              </>
            )}
            {phase === 'recording' && (
              <button type="button" onClick={handleStop} className="btn-otter">
                <Square className="h-4 w-4 fill-current" /> Arrêter
              </button>
            )}
            {phase === 'stopped' && (
              <>
                <button type="button" onClick={handleDiscard} className="btn-glass">
                  <RotateCcw className="h-4 w-4" /> Recommencer
                </button>
                <button type="button" onClick={handleSave} className="btn-otter">
                  <Check className="h-4 w-4" /> Sauvegarder
                </button>
              </>
            )}
            {phase === 'saved' && (
              <>
                {mp4State.kind === 'idle' && (
                  <button
                    type="button"
                    onClick={() => void handleExportMp4()}
                    className="btn-glass"
                    title="Convertir le .webm en .mp4 via ffmpeg"
                  >
                    <FileVideo className="h-4 w-4" /> MP4
                  </button>
                )}
                {mp4State.kind === 'converting' && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-sea-100 px-4 py-2 text-xs font-semibold text-sea-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Conversion…
                  </span>
                )}
                {mp4State.kind === 'done' && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-kelp-100 px-4 py-2 text-xs font-semibold text-kelp-700">
                    <Check className="h-3.5 w-3.5" /> MP4 prêt
                  </span>
                )}
                {mp4State.kind === 'error' && (
                  <span
                    className="inline-flex items-center gap-2 rounded-full bg-coral-100 px-4 py-2 text-xs font-semibold text-coral-700"
                    title={mp4State.reason}
                  >
                    {mp4State.reason === 'ffmpeg-missing' ? 'ffmpeg manquant' : 'Échec'}
                  </span>
                )}
                <button type="button" onClick={handleReveal} className="btn-glass">
                  <FolderOpen className="h-4 w-4" /> Ouvrir
                </button>
                <button type="button" onClick={onClose} className="btn-otter">
                  Terminer
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

// =====================================================================
// PickerView — two-column layout: sources left, config right
// =====================================================================

interface PickerViewProps {
  sources: SourceItem[]
  selectedId: string | null
  onSelect(id: string): void
  onRefresh(): void | Promise<void>
  includeMic: boolean
  onToggleMic(v: boolean): void
  includeSystemAudio: boolean
  onToggleSystemAudio(v: boolean): void
  includeWebcam: boolean
  onToggleWebcam(v: boolean): void
  webcamDevices: MediaDeviceInfo[]
  webcamDeviceId: string | null
  onSelectWebcam(id: string): void
  webcamCorner: Corner
  onSelectCorner(c: Corner): void
  webcamShape: WebcamShape
  onSelectShape(s: WebcamShape): void
  webcamSize: WebcamSize
  onSelectSize(s: WebcamSize): void
  webcamPreviewRef: React.RefObject<HTMLVideoElement>
  bgKind: BackgroundKind
  onSelectBgKind(k: BackgroundKind): void
  bgPresetId: string
  onSelectBgPreset(id: string): void
  bgCustomDataUrl: string | null
  onSelectBgCustom(url: string | null): void
}

function PickerView(props: PickerViewProps) {
  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1.4fr_1fr]">
      {/* LEFT — sources */}
      <div className="flex h-full flex-col gap-3 overflow-hidden">
        <SourcesPane
          sources={props.sources}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          onRefresh={props.onRefresh}
        />
      </div>

      {/* RIGHT — config */}
      <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
        <AudioConfig
          includeMic={props.includeMic}
          onToggleMic={props.onToggleMic}
          includeSystemAudio={props.includeSystemAudio}
          onToggleSystemAudio={props.onToggleSystemAudio}
        />
        <WebcamConfig
          enabled={props.includeWebcam}
          onToggle={props.onToggleWebcam}
          devices={props.webcamDevices}
          deviceId={props.webcamDeviceId}
          onSelectDevice={props.onSelectWebcam}
          corner={props.webcamCorner}
          onSelectCorner={props.onSelectCorner}
          shape={props.webcamShape}
          onSelectShape={props.onSelectShape}
          size={props.webcamSize}
          onSelectSize={props.onSelectSize}
          previewRef={props.webcamPreviewRef}
        />
        <BackgroundConfig
          kind={props.bgKind}
          onSelectKind={props.onSelectBgKind}
          presetId={props.bgPresetId}
          onSelectPreset={props.onSelectBgPreset}
          customDataUrl={props.bgCustomDataUrl}
          onSelectCustom={props.onSelectBgCustom}
        />
      </div>
    </div>
  )
}

// =====================================================================
// SourcesPane — screens + windows in a tight scrollable list
// =====================================================================

interface SourcesPaneProps {
  sources: SourceItem[]
  selectedId: string | null
  onSelect(id: string): void
  onRefresh(): void | Promise<void>
}

function SourcesPane({ sources, selectedId, onSelect, onRefresh }: SourcesPaneProps) {
  const screens = sources.filter((s) => s.kind === 'screen')
  const windows = sources.filter((s) => s.kind === 'window')

  return (
    <div className="otter-glass relative flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
          Source
        </h3>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-sea-700 ring-1 ring-white/60 hover:bg-white/90"
          title="Rafraîchir la liste"
        >
          <RotateCcw className="h-3 w-3" /> Rafraîchir
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        <SourceGroup
          title="Écrans"
          items={screens}
          selectedId={selectedId}
          onSelect={onSelect}
          emptyHint="Aucun écran détecté."
        />
        <SourceGroup
          title="Fenêtres"
          items={windows}
          selectedId={selectedId}
          onSelect={onSelect}
          emptyHint="Aucune fenêtre capturable. Active-la puis rafraîchis."
        />
      </div>
    </div>
  )
}

interface SourceGroupProps {
  title: string
  items: SourceItem[]
  selectedId: string | null
  onSelect(id: string): void
  emptyHint: string
}

function SourceGroup({ title, items, selectedId, onSelect, emptyHint }: SourceGroupProps) {
  return (
    <section>
      <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-sea-700/60">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-cream-800/60">{emptyHint}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((item) => {
            const active = item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-pressed={active}
                className={`group relative overflow-hidden rounded-xl text-left transition-all ${
                  active
                    ? 'ring-2 ring-coral-400 ring-offset-2 ring-offset-white/60 shadow-glow-coral'
                    : 'ring-1 ring-white/50 hover:ring-coral-300/60'
                }`}
              >
                <div className="relative aspect-video w-full bg-sea-200/40">
                  {item.thumbnail === null ? (
                    <div className="flex h-full w-full items-center justify-center text-sea-700/40">
                      <Monitor className="h-6 w-6" />
                    </div>
                  ) : (
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  )}
                  {active && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-coral-500 text-white shadow-glow-coral">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 bg-white/65 px-2 py-1">
                  {item.appIcon !== null && (
                    <img src={item.appIcon} alt="" className="h-3 w-3" />
                  )}
                  <span className="truncate text-[10px] font-semibold text-sea-700">
                    {item.name}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// AudioConfig
// =====================================================================

interface AudioConfigProps {
  includeMic: boolean
  onToggleMic(v: boolean): void
  includeSystemAudio: boolean
  onToggleSystemAudio(v: boolean): void
}

function AudioConfig({
  includeMic,
  onToggleMic,
  includeSystemAudio,
  onToggleSystemAudio
}: AudioConfigProps) {
  return (
    <section className="otter-glass flex flex-col gap-2 p-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
        Audio
      </h3>
      <div className="flex flex-wrap gap-2">
        <ToggleChip
          active={includeMic}
          onChange={onToggleMic}
          IconOn={Mic}
          IconOff={MicOff}
          labelOn="Micro"
          labelOff="Micro"
        />
        <ToggleChip
          active={includeSystemAudio}
          onChange={onToggleSystemAudio}
          IconOn={Volume2}
          IconOff={VolumeX}
          labelOn="Audio système"
          labelOff="Audio système"
        />
      </div>
    </section>
  )
}

// =====================================================================
// WebcamConfig — always visible, with inline enable toggle
// =====================================================================

interface WebcamConfigProps {
  enabled: boolean
  onToggle(v: boolean): void
  devices: MediaDeviceInfo[]
  deviceId: string | null
  onSelectDevice(id: string): void
  corner: Corner
  onSelectCorner(c: Corner): void
  shape: WebcamShape
  onSelectShape(s: WebcamShape): void
  size: WebcamSize
  onSelectSize(s: WebcamSize): void
  previewRef: React.RefObject<HTMLVideoElement>
}

function WebcamConfig({
  enabled,
  onToggle,
  devices,
  deviceId,
  onSelectDevice,
  corner,
  onSelectCorner,
  shape,
  onSelectShape,
  size,
  onSelectSize,
  previewRef
}: WebcamConfigProps) {
  return (
    <section
      className={`otter-glass flex flex-col gap-3 p-3 transition-opacity ${
        enabled ? '' : 'opacity-65'
      }`}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-coral-500" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
            Webcam
          </h3>
        </div>
        <ToggleChip
          active={enabled}
          onChange={onToggle}
          IconOn={Camera}
          IconOff={CameraOff}
          labelOn="Activée"
          labelOff="Désactivée"
        />
      </header>

      <div className={enabled ? '' : 'pointer-events-none'}>
        {devices.length > 1 && (
          <div className="mb-2 flex items-center gap-2">
            <label
              htmlFor="webcam-device"
              className="text-[10px] font-bold uppercase tracking-[0.15em] text-sea-700/70"
            >
              Caméra
            </label>
            <select
              id="webcam-device"
              value={deviceId ?? ''}
              onChange={(e) => onSelectDevice(e.target.value)}
              disabled={!enabled}
              className="flex-1 rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-[11px] text-sea-700"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label.length > 0 ? d.label : 'Caméra sans nom'}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-sea-700/60">
                Position
              </span>
              <CornerPicker value={corner} onChange={onSelectCorner} shape={shape} />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-sea-700/60">
                Forme
              </span>
              <div className="flex gap-1.5">
                <ShapeButton
                  active={shape === 'circle'}
                  onClick={() => onSelectShape('circle')}
                  label="Cercle"
                  Icon={Circle}
                />
                <ShapeButton
                  active={shape === 'rounded'}
                  onClick={() => onSelectShape('rounded')}
                  label="Arrondi"
                  Icon={Squircle}
                />
                <ShapeButton
                  active={shape === 'square'}
                  onClick={() => onSelectShape('square')}
                  label="Carré"
                  Icon={Square}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-sea-700/60">
                Taille
              </span>
              <div className="flex gap-1.5">
                {(['small', 'medium', 'large'] as WebcamSize[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSelectSize(s)}
                    aria-pressed={size === s}
                    className={`flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition-all ${
                      size === s
                        ? 'bg-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/50'
                        : 'bg-white/70 text-sea-700 ring-1 ring-white/60 hover:bg-white/90'
                    }`}
                  >
                    {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-sea-700/60">
              Aperçu
            </span>
            <div
              className="relative h-24 w-24 overflow-hidden bg-deep-900 shadow-glass"
              style={{
                borderRadius: shape === 'circle' ? '50%' : shape === 'rounded' ? 14 : 4
              }}
            >
              <video
                ref={previewRef}
                muted
                playsInline
                className="h-full w-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// =====================================================================
// BackgroundConfig — none / preset / custom upload
// =====================================================================

interface BackgroundConfigProps {
  kind: BackgroundKind
  onSelectKind(k: BackgroundKind): void
  presetId: string
  onSelectPreset(id: string): void
  customDataUrl: string | null
  onSelectCustom(url: string | null): void
}

function BackgroundConfig({
  kind,
  onSelectKind,
  presetId,
  onSelectPreset,
  customDataUrl,
  onSelectCustom
}: BackgroundConfigProps) {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onSelectCustom(reader.result)
        onSelectKind('custom')
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <section className="otter-glass flex flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-3.5 w-3.5 text-coral-500" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
            Fond
          </h3>
        </div>
        <div className="flex gap-1">
          <KindChip active={kind === 'none'} onClick={() => onSelectKind('none')} label="Aucun" />
          <KindChip active={kind === 'preset'} onClick={() => onSelectKind('preset')} label="Preset" />
          <KindChip active={kind === 'custom'} onClick={() => onSelectKind('custom')} label="Custom" />
        </div>
      </header>

      {kind === 'preset' && (
        <div className="grid grid-cols-5 gap-1.5">
          {BG_PRESETS.map((p) => (
            <PresetSwatch
              key={p.id}
              preset={p}
              active={presetId === p.id}
              onClick={() => onSelectPreset(p.id)}
            />
          ))}
        </div>
      )}

      {kind === 'custom' && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="bg-custom-upload"
            className="btn-glass cursor-pointer !py-1.5 !text-[11px]"
            title="Charger une image de fond (PNG, JPG, WebP)"
          >
            <Upload className="h-3.5 w-3.5" />
            {customDataUrl === null ? 'Importer une image' : 'Changer'}
          </label>
          <input
            id="bg-custom-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFile}
            className="hidden"
          />
          {customDataUrl !== null && (
            <div className="relative h-12 w-20 overflow-hidden rounded-lg ring-1 ring-white/60">
              <img src={customDataUrl} alt="Aperçu fond" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onSelectCustom(null)}
                aria-label="Retirer l'image"
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-coral-500 text-white"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {kind === 'none' && (
        <p className="text-[11px] text-cream-800/55">
          L&apos;écran capturé est enregistré tel quel, sans fond ajouté.
        </p>
      )}
    </section>
  )
}

interface KindChipProps {
  active: boolean
  onClick(): void
  label: string
}

function KindChip({ active, onClick, label }: KindChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
        active
          ? 'bg-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/50'
          : 'bg-white/70 text-sea-700 ring-1 ring-white/60 hover:bg-white/90'
      }`}
    >
      {label}
    </button>
  )
}

interface PresetSwatchProps {
  preset: BackgroundPreset
  active: boolean
  onClick(): void
}

function PresetSwatch({ preset, active, onClick }: PresetSwatchProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const c = canvasRef.current
    if (c === null) return
    const ctx = c.getContext('2d')
    if (ctx === null) return
    preset.paint(ctx, c.width, c.height)
  }, [preset])
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={preset.label}
      className={`group relative overflow-hidden rounded-xl transition-all ${
        active
          ? 'ring-2 ring-coral-400 ring-offset-1 ring-offset-white shadow-glow-coral'
          : 'ring-1 ring-white/60 hover:ring-coral-300/60'
      }`}
    >
      <canvas ref={canvasRef} width={160} height={90} className="block h-12 w-full" />
      <span className="absolute inset-x-0 bottom-0 bg-black/35 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
        {preset.label}
      </span>
    </button>
  )
}

// =====================================================================
// CornerPicker / ShapeButton — small shared widgets
// =====================================================================

interface CornerPickerProps {
  value: Corner
  onChange(c: Corner): void
  shape: WebcamShape
}

function CornerPicker({ value, onChange, shape }: CornerPickerProps) {
  const corners: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {corners.map((c) => {
        const active = value === c
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-pressed={active}
            aria-label={`Webcam en position ${c}`}
            className={`relative aspect-video w-full overflow-hidden rounded-lg transition-all ${
              active
                ? 'bg-sea-700/15 ring-2 ring-coral-400'
                : 'bg-white/55 ring-1 ring-white/60 hover:bg-white/75'
            }`}
          >
            <span
              className="absolute h-3 w-3 bg-coral-500 shadow-glow-coral"
              style={{
                top: c.startsWith('top') ? 4 : undefined,
                bottom: c.startsWith('bottom') ? 4 : undefined,
                left: c.endsWith('left') ? 4 : undefined,
                right: c.endsWith('right') ? 4 : undefined,
                borderRadius: shape === 'circle' ? '50%' : shape === 'rounded' ? 3 : 1
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

interface ShapeButtonProps {
  active: boolean
  onClick(): void
  label: string
  Icon: typeof Circle
}

function ShapeButton({ active, onClick, label, Icon }: ShapeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all ${
        active
          ? 'bg-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/50'
          : 'bg-white/70 text-sea-700 ring-1 ring-white/60 hover:bg-white/90'
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

interface ToggleChipProps {
  active: boolean
  onChange(v: boolean): void
  IconOn: typeof Mic
  IconOff: typeof MicOff
  labelOn: string
  labelOff: string
}

function ToggleChip({ active, onChange, IconOn, IconOff, labelOn, labelOff }: ToggleChipProps) {
  const Icon = active ? IconOn : IconOff
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
        active
          ? 'bg-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/40'
          : 'bg-white/70 text-sea-700 ring-1 ring-white/60 hover:bg-white/90'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {active ? labelOn : labelOff}
    </button>
  )
}

// =====================================================================
// ActiveView — compact preview + live controls
// =====================================================================

interface ActiveViewProps {
  phase: Phase
  elapsedMs: number
  formatTime(ms: number): string
  previewRef: React.RefObject<HTMLVideoElement>
  savedPath: string | null
  webcamActive: boolean
  webcamCorner: Corner
  onCornerChange(c: Corner): void
  webcamShape: WebcamShape
  onShapeChange(s: WebcamShape): void
  webcamSize: WebcamSize
  onSizeChange(s: WebcamSize): void
  bgKind: BackgroundKind
  onBgKindChange(k: BackgroundKind): void
  bgPresetId: string
  onBgPresetChange(id: string): void
}

function ActiveView({
  phase,
  elapsedMs,
  formatTime,
  previewRef,
  savedPath,
  webcamActive,
  webcamCorner,
  onCornerChange,
  webcamShape,
  onShapeChange,
  webcamSize,
  onSizeChange,
  bgKind,
  onBgKindChange,
  bgPresetId,
  onBgPresetChange
}: ActiveViewProps) {
  return (
    <div className="flex h-full flex-col items-center gap-3 overflow-hidden">
      <div
        className="relative w-full flex-shrink overflow-hidden rounded-2xl bg-deep-900 shadow-glass-lg"
        style={{ maxHeight: '60vh', aspectRatio: '16 / 9' }}
      >
        <video
          ref={previewRef}
          muted
          playsInline
          className="block h-full w-full bg-deep-900 object-contain"
        />
        {phase === 'recording' && (
          <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-coral-500 px-3 py-1 text-xs font-bold text-white shadow-glow-coral">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inset-0 animate-glow-pulse rounded-full bg-white" />
              <span className="relative h-2 w-2 rounded-full bg-white" />
            </span>
            REC · {formatTime(elapsedMs)}
          </div>
        )}
      </div>

      {phase === 'recording' && (
        <div className="flex w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/50 bg-white/55 p-2 text-[11px] backdrop-blur-md">
          {webcamActive && (
            <>
              <span className="px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
                Webcam
              </span>
              <div className="w-24">
                <CornerPicker value={webcamCorner} onChange={onCornerChange} shape={webcamShape} />
              </div>
              <ShapeButton
                active={webcamShape === 'circle'}
                onClick={() => onShapeChange('circle')}
                label="●"
                Icon={Circle}
              />
              <ShapeButton
                active={webcamShape === 'rounded'}
                onClick={() => onShapeChange('rounded')}
                label="◆"
                Icon={Squircle}
              />
              <ShapeButton
                active={webcamShape === 'square'}
                onClick={() => onShapeChange('square')}
                label="■"
                Icon={Square}
              />
              {(['small', 'medium', 'large'] as WebcamSize[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSizeChange(s)}
                  aria-pressed={webcamSize === s}
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold transition-all ${
                    webcamSize === s
                      ? 'bg-coral-500 text-white ring-1 ring-coral-300/50'
                      : 'bg-white/70 text-sea-700 ring-1 ring-white/60 hover:bg-white/90'
                  }`}
                >
                  {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-sea-700/15" aria-hidden />
            </>
          )}
          <span className="px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
            Fond
          </span>
          <KindChip active={bgKind === 'none'} onClick={() => onBgKindChange('none')} label="Aucun" />
          <KindChip
            active={bgKind === 'preset'}
            onClick={() => onBgKindChange('preset')}
            label="Preset"
          />
          {bgKind === 'preset' && (
            <select
              value={bgPresetId}
              onChange={(e) => onBgPresetChange(e.target.value)}
              className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-semibold text-sea-700 ring-1 ring-white/60"
            >
              {BG_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {phase === 'saved' && savedPath !== null && (
        <p className="otter-badge !rounded-2xl text-center">
          <Check className="h-3.5 w-3.5 text-kelp-500" />
          Sauvegardé : <code className="font-mono text-[11px]">{savedPath}</code>
        </p>
      )}
    </div>
  )
}

// =====================================================================
// Stream + composer plumbing
// =====================================================================

async function acquireScreenStream(sourceId: string, withSystemAudio: boolean): Promise<MediaStream> {
  const videoConstraints: ElectronDesktopConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      minFrameRate: 24,
      maxFrameRate: 60
    }
  }
  const audio: ElectronAudioConstraints | false = withSystemAudio
    ? {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId }
      }
    : false
  return navigator.mediaDevices.getUserMedia({
    video: videoConstraints as unknown as MediaTrackConstraints,
    audio: audio === false ? false : (audio as unknown as MediaTrackConstraints)
  })
}

function mixIntoFinalStream(
  videoStream: MediaStream,
  systemAudioTracks: MediaStreamTrack[],
  micTracks: MediaStreamTrack[]
): MediaStream {
  const out = new MediaStream()
  for (const t of videoStream.getVideoTracks()) out.addTrack(t)
  if (systemAudioTracks.length === 0 && micTracks.length === 0) return out
  const audioCtx = new AudioContext()
  const dest = audioCtx.createMediaStreamDestination()
  for (const t of systemAudioTracks) {
    const s = audioCtx.createMediaStreamSource(new MediaStream([t]))
    s.connect(dest)
  }
  for (const t of micTracks) {
    const s = audioCtx.createMediaStreamSource(new MediaStream([t]))
    s.connect(dest)
  }
  for (const t of dest.stream.getAudioTracks()) out.addTrack(t)
  ;(out as MediaStream & { __audioContext?: AudioContext }).__audioContext = audioCtx
  return out
}

interface ComposerOptions {
  cornerRef: React.MutableRefObject<Corner>
  shapeRef: React.MutableRefObject<WebcamShape>
  sizeRef: React.MutableRefObject<WebcamSize>
  bgKindRef: React.MutableRefObject<BackgroundKind>
  bgPresetIdRef: React.MutableRefObject<string>
  bgCustomBitmapRef: React.MutableRefObject<ImageBitmap | null>
}

interface Composer {
  stream: MediaStream
  stop(): void
}

async function startComposer(
  screenStream: MediaStream,
  webcamStream: MediaStream | null,
  opts: ComposerOptions
): Promise<Composer> {
  const screenVideo = document.createElement('video')
  screenVideo.srcObject = new MediaStream(screenStream.getVideoTracks())
  screenVideo.muted = true
  screenVideo.playsInline = true
  await screenVideo.play()
  if (screenVideo.videoWidth === 0) {
    await new Promise<void>((resolve) => {
      const handler = () => {
        screenVideo.removeEventListener('loadedmetadata', handler)
        resolve()
      }
      screenVideo.addEventListener('loadedmetadata', handler)
    })
  }

  let webcamVideo: HTMLVideoElement | null = null
  if (webcamStream !== null) {
    webcamVideo = document.createElement('video')
    webcamVideo.srcObject = webcamStream
    webcamVideo.muted = true
    webcamVideo.playsInline = true
    await webcamVideo.play()
    if (webcamVideo.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        const handler = () => {
          webcamVideo!.removeEventListener('loadedmetadata', handler)
          resolve()
        }
        webcamVideo!.addEventListener('loadedmetadata', handler)
      })
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = screenVideo.videoWidth
  canvas.height = screenVideo.videoHeight
  const ctx = canvas.getContext('2d', { alpha: false })
  if (ctx === null) throw new Error('Impossible de créer le contexte 2D pour la composition.')

  // Inset padding when a background is on, so the screen feels nicely
  // framed instead of bleeding to the canvas edge.
  const SCREEN_INSET_RATIO = 0.04 // 4% padding on every side
  const SCREEN_RADIUS_RATIO = 0.018 // rounded corners 1.8% of width

  let raf = 0
  let running = true

  const draw = (): void => {
    if (!running) return
    const w = canvas.width
    const h = canvas.height
    const bgKind = opts.bgKindRef.current

    if (bgKind === 'none') {
      // No background — screen fills the canvas (original behavior).
      ctx.drawImage(screenVideo, 0, 0, w, h)
    } else {
      // Paint background first
      if (bgKind === 'preset') {
        const preset = BG_PRESETS.find((p) => p.id === opts.bgPresetIdRef.current)
        if (preset !== undefined) preset.paint(ctx, w, h)
        else {
          ctx.fillStyle = '#0D3548'
          ctx.fillRect(0, 0, w, h)
        }
      } else if (bgKind === 'custom' && opts.bgCustomBitmapRef.current !== null) {
        const bmp = opts.bgCustomBitmapRef.current
        // cover-fit the bitmap into the canvas
        const bgScale = Math.max(w / bmp.width, h / bmp.height)
        const bw = bmp.width * bgScale
        const bh = bmp.height * bgScale
        ctx.drawImage(bmp, (w - bw) / 2, (h - bh) / 2, bw, bh)
      } else {
        ctx.fillStyle = '#07212F'
        ctx.fillRect(0, 0, w, h)
      }

      // Inset, rounded, drop-shadowed screen capture
      const padX = Math.floor(w * SCREEN_INSET_RATIO)
      const padY = Math.floor(h * SCREEN_INSET_RATIO)
      const innerW = w - padX * 2
      const innerH = h - padY * 2
      const r = Math.floor(w * SCREEN_RADIUS_RATIO)

      ctx.save()
      // Soft shadow under the inset screen
      ctx.shadowColor = 'rgba(7, 33, 47, 0.50)'
      ctx.shadowBlur = 28
      ctx.shadowOffsetY = 10
      roundedRectPath(ctx, padX, padY, innerW, innerH, r)
      ctx.fillStyle = '#0D3548' // backstop fill so shadow can render
      ctx.fill()
      ctx.restore()

      ctx.save()
      roundedRectPath(ctx, padX, padY, innerW, innerH, r)
      ctx.clip()
      ctx.drawImage(screenVideo, padX, padY, innerW, innerH)
      ctx.restore()
    }

    // Webcam overlay (always on top, both with and without background)
    if (webcamVideo !== null) {
      const baseEdge = Math.min(w, h)
      const ratio = WEBCAM_SIZE_RATIO[opts.sizeRef.current]
      const camW = Math.floor(baseEdge * ratio * 1.6)
      const camAspect =
        webcamVideo.videoHeight > 0
          ? webcamVideo.videoWidth / webcamVideo.videoHeight
          : 16 / 9
      const camH = Math.floor(camW / camAspect)
      const margin = WEBCAM_MARGIN_PX
      const corner = opts.cornerRef.current
      const cx = corner.endsWith('left') ? margin : w - camW - margin
      const cy = corner.startsWith('top') ? margin : h - camH - margin
      const shape = opts.shapeRef.current

      ctx.save()
      pathForShape(ctx, cx, cy, camW, camH, shape)
      ctx.clip()
      ctx.translate(cx + camW, cy)
      ctx.scale(-1, 1)
      ctx.drawImage(webcamVideo, 0, 0, camW, camH)
      ctx.restore()

      ctx.save()
      ctx.lineWidth = WEBCAM_BORDER_PX
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.shadowColor = 'rgba(7, 33, 47, 0.45)'
      ctx.shadowBlur = 14
      pathForShape(ctx, cx, cy, camW, camH, shape)
      ctx.stroke()
      ctx.restore()
    }

    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  const stream = canvas.captureStream()

  return {
    stream,
    stop(): void {
      running = false
      cancelAnimationFrame(raf)
      screenVideo.srcObject = null
      if (webcamVideo !== null) webcamVideo.srcObject = null
    }
  }
}

function pathForShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: WebcamShape
): void {
  ctx.beginPath()
  if (shape === 'circle') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  } else if (shape === 'rounded') {
    roundedRectPath(ctx, x, y, w, h, Math.min(28, Math.min(w, h) / 6))
  } else {
    ctx.rect(x, y, w, h)
  }
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
