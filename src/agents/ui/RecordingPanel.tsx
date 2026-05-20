import { useCallback, useEffect, useRef, useState } from 'react'
import {
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
  Volume2,
  VolumeX,
  X
} from 'lucide-react'

/**
 * RecordingPanel — full-screen modal that lets the user pick a capture
 * source (screen or window), toggle microphone + system audio, kick off
 * a MediaRecorder session, then save the resulting WebM to disk.
 *
 * The whole pipeline lives in the renderer because Electron exposes
 * `navigator.mediaDevices.getUserMedia` with the legacy chromeMediaSource
 * extension — much smaller than wiring a native capture API for v0.1.
 * Once the user clicks Stop, we ship the Blob's bytes to main via IPC
 * which writes the file under %USERPROFILE%\Videos\PresentOtter\.
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

export function RecordingPanel({ onClose }: RecordingPanelProps) {
  const [sources, setSources] = useState<SourceItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true)
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
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const previewRef = useRef<HTMLVideoElement | null>(null)

  // Pull the source list once on open + refresh button.
  const refreshSources = useCallback(async () => {
    if (window.api === undefined) return
    setError(null)
    try {
      const list = await window.api.recordingListSources()
      setSources(list)
      if (selectedId === null && list.length > 0) {
        // Prefer the first screen entry — that's the "obvious" pick for
        // a new user. Windows come second.
        const firstScreen = list.find((s) => s.kind === 'screen')
        setSelectedId((firstScreen ?? list[0])?.id ?? null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [selectedId])

  useEffect(() => {
    void refreshSources()
  }, [refreshSources])

  // Cleanup on unmount — defensive against the user closing the modal
  // mid-record. Without this, the OS keeps the screen capture indicator
  // glowing in the system tray.
  useEffect(() => {
    return () => {
      stopAllTracks()
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopAllTracks = () => {
    if (streamRef.current !== null) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    if (recorderRef.current !== null && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* ignore — already stopped */
      }
    }
  }

  const handleStart = useCallback(async () => {
    if (selectedId === null) {
      setError('Choisis une source à enregistrer.')
      return
    }
    setError(null)
    setPhase('preparing')

    try {
      // Build the video constraints — Electron's chromeMediaSource
      // extension lets us pin the capture to a specific source ID.
      const videoConstraints: ElectronDesktopConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: selectedId,
          minFrameRate: 24,
          maxFrameRate: 60
        }
      }

      // System audio: Electron only supports it when chromeMediaSource is
      // 'desktop' AND the source is a screen (not a window). We attempt
      // it best-effort and silently drop the audio track if the OS
      // refuses (typical on capture of a single window).
      const wantsSystemAudio =
        includeSystemAudio &&
        (sources.find((s) => s.id === selectedId)?.kind === 'screen')

      let systemAudioConstraints: ElectronDesktopConstraints | undefined
      if (wantsSystemAudio) {
        systemAudioConstraints = {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedId
          }
        }
      }

      const screenStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints as unknown as MediaTrackConstraints,
        audio:
          systemAudioConstraints !== undefined
            ? (systemAudioConstraints as unknown as MediaTrackConstraints)
            : false
      })

      // Microphone — request through standard getUserMedia and mix the
      // resulting audio track onto the main stream. We use a Web Audio
      // graph to mix mic + system audio in case both are present so the
      // output has a single audio track (some players otherwise drop
      // the second one).
      let finalStream: MediaStream = screenStream
      if (includeMic) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          })
          finalStream = mixStreams(screenStream, micStream)
        } catch (err) {
          console.warn('[recording] mic denied / unavailable:', err)
        }
      }

      streamRef.current = finalStream
      if (previewRef.current !== null) {
        previewRef.current.srcObject = finalStream
        void previewRef.current.play().catch(() => {
          /* autoplay denied — preview still works on first user gesture */
        })
      }

      // Pick the best codec the browser advertises. Order: VP9 (best
      // quality/size), then VP8, then default.
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
      recorder.onstop = () => {
        setPhase('stopped')
      }
      recorder.start(1000) // emit a chunk every second so memory stays bounded
      recorderRef.current = recorder

      // Tear the modal back down to "recording" UI + start the timer.
      setPhase('recording')
      const startedAt = performance.now()
      setElapsedMs(0)
      timerRef.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAt)
      }, 250)

      // If the user kills the share via the browser's "Stop sharing"
      // chrome (which Electron exposes as the track ending), wrap up
      // gracefully.
      const videoTrack = finalStream.getVideoTracks()[0]
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
  }, [includeMic, includeSystemAudio, selectedId, sources])

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
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19)
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
    if (res.ok) {
      setMp4State({ kind: 'done', path: res.path })
    } else {
      setMp4State({ kind: 'error', reason: res.reason })
    }
  }, [savedPath])

  const formatTime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const mm = m.toString().padStart(2, '0')
    const ss = s.toString().padStart(2, '0')
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Démarrer un enregistrement d'écran"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md"
      style={{ background: 'rgba(7, 33, 47, 0.42)' }}
    >
      <div className="otter-glass otter-aqua relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden">
        <header className="relative flex items-center justify-between border-b border-white/40 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-bold text-sea-700">
              Enregistrer l&apos;écran
            </h2>
            <p className="text-xs text-cream-800/70">
              Choisis ce que tu veux capturer, ajoute le son si besoin, puis lance.
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
                      ? 'ffmpeg manquant — installe via winget install Gyan.FFmpeg'
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

interface PickerViewProps {
  sources: SourceItem[]
  selectedId: string | null
  onSelect(id: string): void
  onRefresh(): void | Promise<void>
  includeMic: boolean
  onToggleMic(v: boolean): void
  includeSystemAudio: boolean
  onToggleSystemAudio(v: boolean): void
}

function PickerView({
  sources,
  selectedId,
  onSelect,
  onRefresh,
  includeMic,
  onToggleMic,
  includeSystemAudio,
  onToggleSystemAudio
}: PickerViewProps) {
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

interface ActiveViewProps {
  phase: Phase
  elapsedMs: number
  formatTime(ms: number): string
  previewRef: React.RefObject<HTMLVideoElement>
  savedPath: string | null
}

function ActiveView({ phase, elapsedMs, formatTime, previewRef, savedPath }: ActiveViewProps) {
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
      {phase === 'saved' && savedPath !== null && (
        <p className="otter-badge !rounded-2xl text-center">
          <Check className="h-3.5 w-3.5 text-kelp-500" />
          Sauvegardé dans <code className="font-mono text-[11px]">{savedPath}</code>
        </p>
      )}
    </div>
  )
}

/**
 * Mix a screen stream (with optional system-audio track) and a mic
 * stream into a single MediaStream with one video track + one mixed
 * audio track. Without this, some players drop the second audio track
 * silently and you only get one input in the saved file.
 */
function mixStreams(screen: MediaStream, mic: MediaStream): MediaStream {
  const audioCtx = new AudioContext()
  const destination = audioCtx.createMediaStreamDestination()

  const sources: AudioNode[] = []
  for (const track of screen.getAudioTracks()) {
    const s = audioCtx.createMediaStreamSource(new MediaStream([track]))
    s.connect(destination)
    sources.push(s)
  }
  for (const track of mic.getAudioTracks()) {
    const s = audioCtx.createMediaStreamSource(new MediaStream([track]))
    s.connect(destination)
    sources.push(s)
  }

  const out = new MediaStream()
  for (const t of screen.getVideoTracks()) out.addTrack(t)
  for (const t of destination.stream.getAudioTracks()) out.addTrack(t)

  // Keep the underlying tracks alive — closing the AudioContext kills
  // the destination so we hold a reference on the stream itself.
  ;(out as MediaStream & { __audioContext?: AudioContext }).__audioContext = audioCtx
  return out
}
