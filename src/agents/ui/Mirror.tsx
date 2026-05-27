import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Monitor, Play, Power, Sparkles } from 'lucide-react'

/**
 * Mirror window — a normal Chrome window that displays a LIVE feed of
 * one of the user's displays, captured via desktopCapturer + getUserMedia.
 *
 * Why this exists:
 *   When the user shares "a tab" or "a window" in Google Meet / Zoom /
 *   Teams / Discord, the OS pipes only the pixels of that specific HWND
 *   (or Chrome tab) to the conference. Our floating overlay (cursor halo,
 *   pencil strokes, sanitizer masks, …) lives in its OWN window — Meet
 *   filters it out. The user sees nothing modified on the participants'
 *   side.
 *
 * The trick:
 *   Windows DWM composes the desktop INCLUDING the transparent overlay
 *   BEFORE any capture API reads pixels. So a getUserMedia desktop
 *   stream already contains the annotations baked in. We display that
 *   stream inside this Mirror window. The user then shares this Mirror
 *   window inside Meet ("Une fenêtre" → "PresentOtter Mirror") and
 *   participants see the composited result.
 *
 *   Cost: one extra capture+display hop, ~100-150ms more latency.
 *   Acceptable for presentations, not for fast-paced games.
 */

interface DisplayInfo {
  displayId: number
  sourceId: string
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  isPrimary: boolean
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

type StreamState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'live'; sourceId: string }
  | { kind: 'error'; message: string }

export function Mirror(): JSX.Element {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [streamState, setStreamState] = useState<StreamState>({ kind: 'idle' })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Fetch the display list on mount. If only one display is available
  // we pre-select it so the user can just hit "Démarrer".
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = (await window.api?.mirrorListDisplays()) ?? []
      if (cancelled) return
      setDisplays(list)
      const primary = list.find((d) => d.isPrimary) ?? list[0]
      if (primary) setSelectedId(primary.displayId)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selected = useMemo(
    () => displays.find((d) => d.displayId === selectedId) ?? null,
    [displays, selectedId]
  )

  const startStream = useCallback(async () => {
    if (selected === null) return
    setStreamState({ kind: 'starting' })
    // Tear down any previous stream BEFORE allocating the new one to
    // avoid the screen capture pipeline holding two references on the
    // same source.
    if (streamRef.current !== null) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    try {
      const constraints: ElectronDesktopConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: selected.sourceId,
          // Cap to the source's physical resolution. Going higher costs
          // performance for zero visual gain; going lower would scale
          // the captured pixels and the participants would see a blur.
          maxWidth: Math.floor(selected.bounds.width * selected.scaleFactor),
          maxHeight: Math.floor(selected.bounds.height * selected.scaleFactor),
          maxFrameRate: 30
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: constraints as unknown as MediaTrackConstraints
      })
      streamRef.current = stream
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setStreamState({ kind: 'live', sourceId: selected.sourceId })
    } catch (err) {
      console.error('[mirror] getUserMedia failed:', err)
      setStreamState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }, [selected])

  const stopStream = useCallback(() => {
    if (streamRef.current !== null) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    if (videoRef.current !== null) {
      videoRef.current.srcObject = null
    }
    setStreamState({ kind: 'idle' })
  }, [])

  // Clean up the stream when the window unmounts (the user closed it).
  useEffect(() => {
    return () => {
      if (streamRef.current !== null) {
        for (const track of streamRef.current.getTracks()) track.stop()
        streamRef.current = null
      }
    }
  }, [])

  const isLive = streamState.kind === 'live'

  return (
    <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 p-6 lg:p-8 text-sea-700">
      {/* Page intro — light surface to match the Home theme. The
          deep-themed video stage lives in the card below. */}
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">
          Miroir Meet
        </h1>
        <p className="text-sm text-cream-800/75">
          Page à partager dans Meet / Zoom (mode « Une fenêtre »). Les annotations,
          le curseur custom et les masques du sanitizer sont déjà composités dedans.
        </p>
      </header>

      {/* Video stage — keeps the dark surface so the live feed reads
          cleanly without the otter mesh background bleeding through. */}
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-2xl bg-black ring-1 ring-deep-950/40 shadow-glass">
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          muted
          playsInline
          autoPlay
        />

        {/* Idle / error overlay */}
        {!isLive && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="glass glass-shine flex w-full max-w-xl flex-col gap-5 rounded-2xl p-7">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-coral-500/15 text-coral-300">
                  <Sparkles className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-otter-50">
                    Activer le partage miroir
                  </h2>
                  <p className="mt-0.5 text-xs text-otter-200/70 leading-relaxed">
                    Choisis l&apos;écran à reproduire. Cette fenêtre affichera un
                    flux live de l&apos;écran <strong>avec tes annotations et le
                    curseur custom déjà composités dedans</strong>. Tu n&apos;as
                    plus qu&apos;à partager <em>cette</em> fenêtre dans Meet
                    (option « Une fenêtre »).
                  </p>
                </div>
              </div>

              {displays.length === 0 && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-otter-200/70">
                  Chargement des écrans disponibles…
                </div>
              )}

              {displays.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-otter-300">
                    Écran à reproduire
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {displays.map((d) => {
                      const active = d.displayId === selectedId
                      return (
                        <button
                          key={d.displayId}
                          type="button"
                          onClick={() => setSelectedId(d.displayId)}
                          className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-all duration-200 ${
                            active
                              ? 'bg-gradient-to-br from-otter-500/30 to-otter-600/15 ring-1 ring-otter-300/40'
                              : 'bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-white/[0.06]'
                          }`}
                        >
                          <Monitor
                            className={`h-4 w-4 flex-shrink-0 ${
                              active ? 'text-otter-200' : 'text-otter-300/70'
                            }`}
                            strokeWidth={1.75}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">
                              {d.label}
                              {d.isPrimary && (
                                <span className="ml-2 inline-block rounded-full bg-coral-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-coral-200">
                                  Principal
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-otter-200/60 font-mono">
                              {d.bounds.width} × {d.bounds.height} @ {d.scaleFactor}x
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {streamState.kind === 'error' && (
                <div className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />
                  <div>
                    <p className="font-semibold">Capture impossible</p>
                    <p className="text-[11px] text-red-200/80">
                      {streamState.message}
                    </p>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => void startStream()}
                disabled={selected === null || streamState.kind === 'starting'}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-coral-400 to-coral-500 px-5 py-3 text-sm font-bold text-white shadow-glow-coral ring-1 ring-coral-300/40 transition hover:from-coral-300 hover:to-coral-500 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                {streamState.kind === 'starting'
                  ? 'Démarrage…'
                  : 'Démarrer le partage miroir'}
              </button>
            </div>
          </div>
        )}

        {/* Live HUD — small bar at the top so the user remembers this
            window is the one to share. Click "Stop" to release the
            capture stream (frees GPU work). */}
        {isLive && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-2.5">
            <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-deep-950/80 px-3 py-1.5 text-[11px] text-otter-100 backdrop-blur-md ring-1 ring-white/[0.08]">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-coral-400 animate-glow-pulse" />
                <span className="relative h-2 w-2 rounded-full bg-coral-500" />
              </span>
              <span className="font-semibold">Miroir actif</span>
              <span className="text-otter-200/65">·</span>
              <span className="text-otter-200/85">
                Partage <em>cette</em> fenêtre dans Meet
              </span>
            </div>
            <button
              type="button"
              onClick={stopStream}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-red-500/85 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-red-300/40 backdrop-blur-md transition hover:bg-red-500"
            >
              <Power className="h-3 w-3" />
              Arrêter
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
