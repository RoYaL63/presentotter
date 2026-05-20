import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  CameraOff,
  Check,
  Circle,
  FileVideo,
  FolderOpen,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  RotateCcw,
  Square,
  Squircle,
  User,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'

/**
 * RecordingPanel — full-screen modal that lets the user pick a capture
 * source (screen or window), toggle microphone + system audio + webcam
 * picture-in-picture, kick off a MediaRecorder session, then save the
 * resulting WebM to disk.
 *
 * When webcam PiP is on, the screen + webcam streams are composed into
 * an offscreen canvas at the source resolution, and we record the
 * canvas's captureStream() rather than the raw screen. The webcam
 * appears at the chosen corner with the chosen shape and size, with a
 * soft white border for legibility. Audio still mixes mic + system in
 * a Web Audio graph so the final file has a single mixed track.
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

/** Webcam diameter as a fraction of the screen video's longest edge. */
const WEBCAM_SIZE_RATIO: Record<WebcamSize, number> = {
  small: 0.10,
  medium: 0.16,
  large: 0.24
}

/** Pixel margin from the screen edges to the webcam frame. */
const WEBCAM_MARGIN_PX = 28

/** Border thickness around the composited webcam, in source pixels. */
const WEBCAM_BORDER_PX = 5

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

  // Refs are kept off React state — they outlive renders, do not trigger
  // re-renders, and need to be released deterministically on stop.
  const streamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const composerRef = useRef<Composer | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const previewRef = useRef<HTMLVideoElement | null>(null)
  // Webcam preview shown during the picker phase (small floating box).
  const webcamPreviewRef = useRef<HTMLVideoElement | null>(null)
  const pickerWebcamStreamRef = useRef<MediaStream | null>(null)

  // Live composer settings — when the user changes corner/shape/size
  // during recording, the composer reads from these refs on every frame.
  const cornerRef = useRef<Corner>(webcamCorner)
  const shapeRef = useRef<WebcamShape>(webcamShape)
  const sizeRef = useRef<WebcamSize>(webcamSize)
  cornerRef.current = webcamCorner
  shapeRef.current = webcamShape
  sizeRef.current = webcamSize

  // -----------------------------------------------------------------
  // Source enumeration (screens + windows + webcams)
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

  // Start / stop the small live preview of the webcam in the picker —
  // gives the user instant feedback while they pick a corner/shape.
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
  // Lifecycle cleanup
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
  // Start / Stop / Save
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
          webcamStream = await navigator.mediaDevices.getUserMedia({
            video: cam,
            audio: false
          })
          webcamStreamRef.current = webcamStream
        } catch (err) {
          console.warn('[recording] webcam denied; recording without PiP:', err)
        }
      }

      let micStream: MediaStream | null = null
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          })
        } catch (err) {
          console.warn('[recording] mic denied:', err)
        }
      }

      // Build the recording video source: composed canvas if webcam is on,
      // raw screen otherwise. Audio is mixed regardless.
      let videoStreamForRecorder: MediaStream
      if (webcamStream !== null) {
        const composer = await startComposer(screenStream, webcamStream, {
          cornerRef,
          shapeRef,
          sizeRef
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
        void previewRef.current.play().catch(() => {
          /* autoplay denied is fine — user gesture will resume */
        })
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

      // If the user clicks "Stop sharing" in Chromium's chrome, wrap up.
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
      className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md"
      style={{ background: 'rgba(7, 33, 47, 0.42)' }}
    >
      <div className="otter-glass otter-aqua relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden">
        <header className="relative flex items-center justify-between border-b border-white/40 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-bold text-sea-700">
              Enregistrer l&apos;écran
            </h2>
            <p className="text-xs text-cream-800/70">
              Source, audio, webcam picture-in-picture. Tout en un seul fichier.
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

        <div className="relative flex-1 overflow-y-auto px-6 py-5">
          {error !== null && (
            <div
              role="alert"
              className="mb-4 rounded-2xl border border-coral-400/60 bg-coral-100/80 px-4 py-2.5 text-sm text-coral-700"
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
            />
          )}
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t border-white/40 bg-white/40 px-6 py-3 backdrop-blur-md">
          <span className="text-[11px] text-cream-800/60">
            {phase === 'picking' && '🦦 Les vidéos sont sauvegardées dans Vidéos\\PresentOtter\\'}
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
                <Check className="h-3.5 w-3.5" /> Sauvegardé : {savedPath}
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
                    title="Convertir le .webm en .mp4 via ffmpeg (installation locale requise)"
                  >
                    <FileVideo className="h-4 w-4" /> Exporter en MP4
                  </button>
                )}
                {mp4State.kind === 'converting' && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-sea-100 px-4 py-2 text-xs font-semibold text-sea-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Conversion MP4…
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
                    {mp4State.reason === 'ffmpeg-missing'
                      ? 'ffmpeg manquant — winget install Gyan.FFmpeg'
                      : `Erreur conversion : ${mp4State.reason}`}
                  </span>
                )}
                <button type="button" onClick={handleReveal} className="btn-glass">
                  <FolderOpen className="h-4 w-4" /> Ouvrir le dossier
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
// PickerView — source + audio + webcam settings
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
}

function PickerView(props: PickerViewProps) {
  const {
    sources,
    selectedId,
    onSelect,
    onRefresh,
    includeMic,
    onToggleMic,
    includeSystemAudio,
    onToggleSystemAudio,
    includeWebcam,
    onToggleWebcam,
    webcamDevices,
    webcamDeviceId,
    onSelectWebcam,
    webcamCorner,
    onSelectCorner,
    webcamShape,
    onSelectShape,
    webcamSize,
    onSelectSize,
    webcamPreviewRef
  } = props

  const screens = sources.filter((s) => s.kind === 'screen')
  const windows = sources.filter((s) => s.kind === 'window')

  return (
    <div className="flex flex-col gap-5">
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
        emptyHint="Aucune fenêtre ouverte n'est capturable. Active la fenêtre puis rafraîchis."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/50 bg-white/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleChip
            active={includeMic}
            onChange={onToggleMic}
            IconOn={Mic}
            IconOff={MicOff}
            labelOn="Micro activé"
            labelOff="Micro désactivé"
          />
          <ToggleChip
            active={includeSystemAudio}
            onChange={onToggleSystemAudio}
            IconOn={Volume2}
            IconOff={VolumeX}
            labelOn="Audio système activé"
            labelOff="Audio système désactivé"
          />
          <ToggleChip
            active={includeWebcam}
            onChange={onToggleWebcam}
            IconOn={Camera}
            IconOff={CameraOff}
            labelOn="Webcam activée"
            labelOff="Webcam désactivée"
          />
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="btn-glass"
          title="Recharger la liste des sources"
        >
          <RotateCcw className="h-4 w-4" /> Rafraîchir
        </button>
      </div>

      {includeWebcam && (
        <WebcamConfig
          devices={webcamDevices}
          deviceId={webcamDeviceId}
          onSelectDevice={onSelectWebcam}
          corner={webcamCorner}
          onSelectCorner={onSelectCorner}
          shape={webcamShape}
          onSelectShape={onSelectShape}
          size={webcamSize}
          onSelectSize={onSelectSize}
          previewRef={webcamPreviewRef}
        />
      )}
    </div>
  )
}

// =====================================================================
// WebcamConfig — corner / shape / size picker
// =====================================================================

interface WebcamConfigProps {
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
    <section className="grid grid-cols-1 gap-4 rounded-3xl border border-white/50 bg-white/35 p-5 lg:grid-cols-[1fr_auto]">
      <div className="flex flex-col gap-4">
        <header className="flex items-center gap-2">
          <User className="h-4 w-4 text-coral-500" />
          <h3 className="text-sm font-bold tracking-tight text-sea-700">Webcam</h3>
        </header>

        {/* Device selector — only shown if multiple cameras exist */}
        {devices.length > 1 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="webcam-device"
              className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70"
            >
              Caméra
            </label>
            <select
              id="webcam-device"
              value={deviceId ?? ''}
              onChange={(e) => onSelectDevice(e.target.value)}
              className="rounded-xl border border-white/60 bg-white/70 px-3 py-1.5 text-xs text-sea-700"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label.length > 0 ? d.label : 'Caméra sans nom'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Corner — 2x2 grid that doubles as a visual position picker */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
            Position
          </span>
          <CornerPicker value={corner} onChange={onSelectCorner} shape={shape} />
        </div>

        {/* Shape selector */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
            Forme
          </span>
          <div className="flex gap-2">
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

        {/* Size selector */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
            Taille
          </span>
          <div className="flex gap-2">
            {(['small', 'medium', 'large'] as WebcamSize[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSelectSize(s)}
                aria-pressed={size === s}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
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

      {/* Live preview */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
          Aperçu
        </span>
        <div
          className="relative h-32 w-32 overflow-hidden bg-deep-900 shadow-glass"
          style={{
            borderRadius: shape === 'circle' ? '50%' : shape === 'rounded' ? 16 : 4
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
    </section>
  )
}

interface CornerPickerProps {
  value: Corner
  onChange(c: Corner): void
  shape: WebcamShape
}

function CornerPicker({ value, onChange, shape }: CornerPickerProps) {
  // 2x2 visual grid; the active corner shows a coral dot in the right spot.
  const corners: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  return (
    <div className="grid grid-cols-2 gap-2">
      {corners.map((c) => {
        const active = value === c
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-pressed={active}
            aria-label={`Webcam en position ${c}`}
            className={`relative aspect-video w-full overflow-hidden rounded-xl transition-all ${
              active
                ? 'bg-sea-700/15 ring-2 ring-coral-400'
                : 'bg-white/55 ring-1 ring-white/60 hover:bg-white/75'
            }`}
          >
            <span
              className="absolute h-3.5 w-3.5 bg-coral-500 shadow-glow-coral"
              style={{
                top: c.startsWith('top') ? 6 : undefined,
                bottom: c.startsWith('bottom') ? 6 : undefined,
                left: c.endsWith('left') ? 6 : undefined,
                right: c.endsWith('right') ? 6 : undefined,
                borderRadius: shape === 'circle' ? '50%' : shape === 'rounded' ? 4 : 1
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
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
        active
          ? 'bg-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/50'
          : 'bg-white/70 text-sea-700 ring-1 ring-white/60 hover:bg-white/90'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

// =====================================================================
// SourceGroup — picker UI for screens/windows
// =====================================================================

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
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-cream-800/60">{emptyHint}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const active = item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-pressed={active}
                className={`group relative overflow-hidden rounded-2xl text-left transition-all ${
                  active
                    ? 'ring-2 ring-coral-400 ring-offset-2 ring-offset-white/60 shadow-glow-coral'
                    : 'ring-1 ring-white/50 hover:ring-coral-300/60 hover:-translate-y-0.5'
                }`}
              >
                <div className="relative aspect-video w-full bg-sea-200/40">
                  {item.thumbnail === null ? (
                    <div className="flex h-full w-full items-center justify-center text-sea-700/40">
                      <Monitor className="h-8 w-8" />
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
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-coral-500 text-white shadow-glow-coral">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 bg-white/65 px-2.5 py-1.5">
                  {item.appIcon !== null && (
                    <img src={item.appIcon} alt="" className="h-4 w-4" />
                  )}
                  <span className="truncate text-xs font-semibold text-sea-700">
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
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
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
// ActiveView — preview during recording / stopped / saved phases
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
  onSizeChange
}: ActiveViewProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full overflow-hidden rounded-3xl bg-deep-900 shadow-glass-lg">
        <video
          ref={previewRef}
          muted
          playsInline
          className="block aspect-video w-full bg-deep-900 object-contain"
        />
        {phase === 'recording' && (
          <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-coral-500 px-3 py-1 text-xs font-bold text-white shadow-glow-coral">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inset-0 animate-glow-pulse rounded-full bg-white" />
              <span className="relative h-2 w-2 rounded-full bg-white" />
            </span>
            REC · {formatTime(elapsedMs)}
          </div>
        )}
      </div>

      {/* Live webcam controls — visible during recording so the user can
          retouch corner/shape/size without restarting. Composer reads the
          settings via refs every frame. */}
      {webcamActive && phase === 'recording' && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/50 bg-white/55 p-2 backdrop-blur-md">
          <span className="px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-sea-700/70">
            Webcam
          </span>
          <CornerPicker value={webcamCorner} onChange={onCornerChange} shape={webcamShape} />
          <div className="flex gap-1">
            <ShapeButton
              active={webcamShape === 'circle'}
              onClick={() => onShapeChange('circle')}
              label="Cercle"
              Icon={Circle}
            />
            <ShapeButton
              active={webcamShape === 'rounded'}
              onClick={() => onShapeChange('rounded')}
              label="Arrondi"
              Icon={Squircle}
            />
            <ShapeButton
              active={webcamShape === 'square'}
              onClick={() => onShapeChange('square')}
              label="Carré"
              Icon={Square}
            />
          </div>
          <div className="flex gap-1">
            {(['small', 'medium', 'large'] as WebcamSize[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSizeChange(s)}
                aria-pressed={webcamSize === s}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  webcamSize === s
                    ? 'bg-coral-500 text-white shadow-glow-coral ring-1 ring-coral-300/50'
                    : 'bg-white/70 text-sea-700 ring-1 ring-white/60 hover:bg-white/90'
                }`}
              >
                {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'saved' && savedPath !== null && (
        <p className="otter-badge !rounded-2xl text-center">
          <Check className="h-3.5 w-3.5 text-kelp-500" />
          Sauvegardé dans <code className="font-mono text-[11px]">{savedPath}</code>
        </p>
      )}
    </div>
  )
}

// =====================================================================
// Stream helpers
// =====================================================================

interface ElectronAudioConstraints {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
  }
}

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
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    : false
  return navigator.mediaDevices.getUserMedia({
    video: videoConstraints as unknown as MediaTrackConstraints,
    audio: audio === false ? false : (audio as unknown as MediaTrackConstraints)
  })
}

/**
 * Combine a recording video stream with system + mic audio tracks into a
 * single MediaStream with one video + one mixed audio track. Players
 * sometimes drop the second audio track silently otherwise.
 */
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

// =====================================================================
// Composer — canvas-based screen + webcam composition
// =====================================================================

interface ComposerOptions {
  cornerRef: React.MutableRefObject<Corner>
  shapeRef: React.MutableRefObject<WebcamShape>
  sizeRef: React.MutableRefObject<WebcamSize>
}

interface Composer {
  stream: MediaStream
  stop(): void
}

/**
 * Build an offscreen <canvas> sized to the screen video, paint the
 * screen frames onto it every rAF tick, then overlay the webcam in the
 * chosen corner with the chosen shape + size. The captureStream() from
 * the canvas is what MediaRecorder consumes — so the saved file has the
 * PiP baked in.
 *
 * Settings are read from React refs at every frame, which means the
 * user can change corner / shape / size LIVE during recording without
 * having to restart.
 */
async function startComposer(
  screenStream: MediaStream,
  webcamStream: MediaStream,
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

  const webcamVideo = document.createElement('video')
  webcamVideo.srcObject = webcamStream
  webcamVideo.muted = true
  webcamVideo.playsInline = true
  await webcamVideo.play()
  if (webcamVideo.videoWidth === 0) {
    await new Promise<void>((resolve) => {
      const handler = () => {
        webcamVideo.removeEventListener('loadedmetadata', handler)
        resolve()
      }
      webcamVideo.addEventListener('loadedmetadata', handler)
    })
  }

  const canvas = document.createElement('canvas')
  canvas.width = screenVideo.videoWidth
  canvas.height = screenVideo.videoHeight
  const ctx = canvas.getContext('2d', { alpha: false })
  if (ctx === null) {
    throw new Error('Impossible de créer le contexte 2D pour la composition.')
  }

  let raf = 0
  let running = true

  const draw = (): void => {
    if (!running) return
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)

    // Webcam target box — sized as a fraction of the screen's shorter
    // edge so wide ultrawides don't get oversized cams.
    const ratio = WEBCAM_SIZE_RATIO[opts.sizeRef.current]
    const baseEdge = Math.min(canvas.width, canvas.height)
    const camW = Math.floor(baseEdge * ratio * 1.6) // slight widen for 16:9 webcams
    const camAspect =
      webcamVideo.videoHeight > 0 ? webcamVideo.videoWidth / webcamVideo.videoHeight : 16 / 9
    const camH = Math.floor(camW / camAspect)

    const margin = WEBCAM_MARGIN_PX
    const corner = opts.cornerRef.current
    const cx =
      corner.endsWith('left') ? margin : canvas.width - camW - margin
    const cy =
      corner.startsWith('top') ? margin : canvas.height - camH - margin

    const shape = opts.shapeRef.current

    // Clip the webcam to the desired shape, draw it, then stroke a
    // soft border so it stays legible on any background.
    ctx.save()
    pathForShape(ctx, cx, cy, camW, camH, shape)
    ctx.clip()
    // Mirror the webcam horizontally — feels more natural to the user
    // (they see themselves as if in a mirror).
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

    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  // captureStream() with no FPS argument samples the canvas at every
  // commit — that matches our rAF cadence (typically 60 Hz, capped to
  // monitor refresh).
  const stream = canvas.captureStream()

  return {
    stream,
    stop(): void {
      running = false
      cancelAnimationFrame(raf)
      screenVideo.srcObject = null
      webcamVideo.srcObject = null
    }
  }
}

/**
 * Path the chosen webcam shape on the current ctx. Caller is expected
 * to either clip() (to mask the webcam draw) or stroke() (for the
 * border) right after, then restore().
 */
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
    // Inscribed ellipse — looks like a circle when the webcam is square.
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  } else if (shape === 'rounded') {
    const r = Math.min(28, Math.min(w, h) / 6)
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
  } else {
    ctx.rect(x, y, w, h)
  }
}
