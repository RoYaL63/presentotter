import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  Keyboard,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Video
} from 'lucide-react'
import type { CaptureConfig, ExportFormat } from '@interfaces'

interface UpdateCheck {
  currentVersion: string
  latestVersion: string
  upToDate: boolean
  downloadUrl: string | null
  downloadSizeMb: number | null
  htmlUrl: string | null
  publishedAt: string | null
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; check: UpdateCheck }
  | { kind: 'error'; message: string }

type DownloadState =
  | { kind: 'idle' }
  | { kind: 'downloading'; downloaded: number; total: number }
  | { kind: 'launching' }
  | { kind: 'done'; path: string }
  /** Download finished but the shell launch was rejected — typically
   *  Smart App Control / WDAC blocking the unsigned binary. The
   *  renderer offers a "open the folder" button so the user can
   *  right-click → Properties → Unblock manually. */
  | { kind: 'blocked'; path: string; reason: string }
  | { kind: 'error'; message: string }

type HotkeyId = 'capturePhoto' | 'captureVideo'

/** Map a KeyboardEvent's main (non-modifier) key to an Electron
 *  accelerator key name, or null if it can't be a shortcut key. */
function normalizeKey(e: KeyboardEvent): string | null {
  const k = e.key
  if (k.length === 1) return k === ' ' ? 'Space' : k.toUpperCase()
  const map: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return'
  }
  if (map[k] !== undefined) return map[k]
  if (/^F\d{1,2}$/.test(k)) return k
  if (
    [
      'PrintScreen',
      'Insert',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Delete',
      'Tab',
      'Backspace'
    ].includes(k)
  ) {
    return k
  }
  return null
}

/** Pretty-print an Electron accelerator for display (FR-ish). */
function formatCombo(accel: string): string {
  return accel
    .split('+')
    .map((p) =>
      p === 'Shift'
        ? 'Maj'
        : p === 'Control'
          ? 'Ctrl'
          : p === 'Super'
            ? 'Win'
            : p
    )
    .join(' + ')
}

export function Settings() {
  const [fps, setFps] = useState<CaptureConfig['fps']>(30)
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' })
  const [download, setDownload] = useState<DownloadState>({ kind: 'idle' })
  const [hotkeys, setHotkeys] = useState<{
    capturePhoto: string
    captureVideo: string
  } | null>(null)
  const [capturing, setCapturing] = useState<HotkeyId | null>(null)
  const [hkWarning, setHkWarning] = useState<string | null>(null)
  const [openAtLogin, setOpenAtLoginState] = useState(false)

  // The renderer never decides on a version on its own. The Vite-
  // injected __APP_VERSION__ is the SAME source as the main process's
  // app.getVersion() (both come from package.json#version), so the
  // Home footer and this page always agree.
  const buildVersion = __APP_VERSION__

  // Wire up the download-progress events from main.
  useEffect(() => {
    const off = window.api?.onUpdateProgress(({ downloaded, total }) => {
      setDownload((d) =>
        d.kind === 'downloading' ? { kind: 'downloading', downloaded, total } : d
      )
    })
    return off
  }, [])

  // Load current capture hotkeys + startup setting once.
  useEffect(() => {
    void window.api?.getCaptureHotkeys().then(setHotkeys)
    void window.api?.getOpenAtLogin().then(setOpenAtLoginState)
  }, [])

  const toggleStartup = useCallback(async () => {
    const next = !openAtLogin
    const applied = await window.api?.setOpenAtLogin(next)
    if (applied !== undefined) setOpenAtLoginState(applied)
  }, [openAtLogin])

  // While capturing a new combo, listen for the next key chord.
  useEffect(() => {
    if (capturing === null) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) return
      const main = normalizeKey(e)
      if (main === null) return
      const mods: string[] = []
      if (e.ctrlKey) mods.push('Control')
      if (e.altKey) mods.push('Alt')
      if (e.shiftKey) mods.push('Shift')
      if (e.metaKey) mods.push('Super')
      const solo = /^(F\d{1,2}|PrintScreen|Insert|Pause)$/.test(main)
      if (mods.length === 0 && !solo) {
        setHkWarning('Ajoute au moins un modificateur (Alt, Ctrl, Maj).')
        return
      }
      const accel = [...mods, main].join('+')
      const id = capturing
      setCapturing(null)
      void window.api
        ?.setCaptureHotkeys({ [id]: accel })
        .then((res) => {
          setHotkeys(res.hotkeys)
          const ok =
            id === 'capturePhoto' ? res.capturePhotoOk : res.captureVideoOk
          setHkWarning(
            ok
              ? null
              : 'Raccourci enregistré, mais une autre app le capte peut-être déjà.'
          )
        })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing])

  const resetHotkeys = useCallback(async () => {
    const def = await window.api?.defaultCaptureHotkeys()
    if (def === undefined) return
    const res = await window.api?.setCaptureHotkeys(def)
    if (res !== undefined) {
      setHotkeys(res.hotkeys)
      setHkWarning(null)
    }
  }, [])

  const handleCheck = useCallback(async () => {
    if (window.api === undefined) return
    setCheck({ kind: 'checking' })
    try {
      const res = await window.api.checkForUpdate()
      setCheck({ kind: 'result', check: res })
    } catch (err) {
      setCheck({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }, [])

  const handleDownload = useCallback(async () => {
    if (window.api === undefined) return
    if (check.kind !== 'result') return
    const url = check.check.downloadUrl
    if (url === null) return
    setDownload({ kind: 'downloading', downloaded: 0, total: 0 })
    try {
      const res = await window.api.downloadAndLaunchUpdate(url)
      if (res.launched) {
        setDownload({ kind: 'done', path: res.path })
      } else {
        // Smart App Control / WDAC rejected the shell launch. Surface
        // a dedicated state so the user gets the "open the folder"
        // escape hatch instead of a generic error.
        setDownload({
          kind: 'blocked',
          path: res.path,
          reason: res.launchError ?? 'Lancement refusé par Windows'
        })
      }
    } catch (err) {
      setDownload({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }, [check])

  const handleRevealInstaller = useCallback(async () => {
    if (window.api === undefined) return
    if (download.kind !== 'blocked') return
    await window.api.revealInstaller(download.path)
  }, [download])

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8 lg:p-12">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-4xl font-bold tracking-tight text-otter-50">Paramètres</h1>
        <p className="text-base text-otter-200/70">
          Configure les valeurs par défaut de l&apos;application.
        </p>
      </header>

      {/* About / version — large hero card at the top so the user
          always sees which build is running. The Check + Download
          buttons live right next to the number. */}
      <div className="glass glass-shine flex flex-col gap-5 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-4xl" aria-hidden>🦦</span>
            <div>
              <p className="text-lg font-semibold text-otter-50">PresentOtter</p>
              <p className="font-mono text-3xl font-black tracking-tight text-otter-50">
                v{buildVersion}
              </p>
              <p className="mt-0.5 text-xs text-otter-200/60">
                OTTERWISE Solutions · open-source MIT
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={check.kind === 'checking'}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-coral-400 to-coral-500 px-5 py-2.5 text-sm font-bold text-white shadow-glow-coral ring-1 ring-coral-300/40 transition hover:from-coral-300 hover:to-coral-500 disabled:opacity-50"
          >
            {check.kind === 'checking' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Vérification…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Vérifier les mises à jour
              </>
            )}
          </button>
        </div>

        {check.kind === 'error' && (
          <div className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-300" />
            <div>
              <p className="font-semibold">Impossible de vérifier la version</p>
              <p className="text-xs text-red-200/75">{check.message}</p>
              <p className="mt-1 text-[10px] text-red-200/55">
                Pas de connexion internet ? Tu peux toujours télécharger manuellement
                depuis github.com/RoYaL63/presentotter/releases.
              </p>
            </div>
          </div>
        )}

        {check.kind === 'result' && check.check.upToDate && (
          <div className="flex items-start gap-2 rounded-xl border border-kelp-400/40 bg-kelp-400/10 p-3 text-sm text-kelp-100">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-kelp-300" />
            <div>
              <p className="font-semibold">Tu es à jour</p>
              <p className="text-xs text-kelp-100/70">
                Dernière version publiée :{' '}
                <span className="font-mono">v{check.check.latestVersion}</span>
              </p>
            </div>
          </div>
        )}

        {check.kind === 'result' && !check.check.upToDate && (
          <div className="flex flex-col gap-3 rounded-xl border border-coral-400/45 bg-coral-500/10 p-4 text-sm text-coral-100">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-coral-300" />
              <div className="flex-1">
                <p className="font-semibold text-otter-50">
                  Une nouvelle version est disponible :{' '}
                  <span className="font-mono">v{check.check.latestVersion}</span>
                </p>
                <p className="mt-0.5 text-xs text-coral-100/80">
                  {check.check.downloadSizeMb !== null
                    ? `Setup.exe de ${check.check.downloadSizeMb} MB. `
                    : ''}
                  Le téléchargement se fait dans le dossier temporaire de Windows, puis
                  l&apos;installeur s&apos;ouvre — suis le wizard pour finir.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {download.kind === 'idle' && check.check.downloadUrl !== null && (
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  className="inline-flex items-center gap-2 rounded-full bg-coral-500 px-4 py-2 text-sm font-bold text-white ring-1 ring-coral-300/50 shadow-glow-coral transition hover:bg-coral-400"
                >
                  <Download className="h-4 w-4" />
                  Télécharger et installer
                </button>
              )}
              {download.kind === 'downloading' && (
                <div className="flex w-full flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs text-otter-100">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Téléchargement…{' '}
                    {download.total > 0
                      ? `${(download.downloaded / 1024 / 1024).toFixed(1)} / ${(
                          download.total / 1024 / 1024
                        ).toFixed(1)} MB`
                      : `${(download.downloaded / 1024 / 1024).toFixed(1)} MB`}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-gradient-to-r from-coral-400 to-coral-500 transition-[width] duration-150"
                      style={{
                        width:
                          download.total > 0
                            ? `${Math.min(100, (download.downloaded / download.total) * 100)}%`
                            : '12%'
                      }}
                    />
                  </div>
                </div>
              )}
              {download.kind === 'done' && (
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-kelp-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Installeur ouvert — suis le wizard.
                </div>
              )}
              {download.kind === 'blocked' && (
                <div className="flex w-full flex-col gap-2 rounded-xl border border-sunray-400/40 bg-sunray-500/10 p-3 text-xs text-sunray-100">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-sunray-300" />
                    <div className="flex-1">
                      <p className="font-semibold text-otter-50">
                        Windows a bloqué l&apos;installeur (Smart App Control)
                      </p>
                      <p className="mt-0.5 text-[11px] text-sunray-100/80 leading-relaxed">
                        Le fichier est téléchargé mais Windows a refusé de
                        le lancer. Ouvre le dossier ci-dessous, clic-droit
                        sur le Setup → <strong>Propriétés</strong> → coche{' '}
                        <strong>« Débloquer »</strong> en bas, puis double-clic
                        pour installer.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRevealInstaller()}
                    className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sunray-500/80 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-sunray-300/40 transition hover:bg-sunray-400"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Ouvrir le dossier de téléchargement
                  </button>
                </div>
              )}
              {download.kind === 'error' && (
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-red-200">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {download.message}
                </div>
              )}
              {check.check.htmlUrl !== null && (
                <a
                  href={check.check.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-otter-200/75 hover:text-otter-100"
                >
                  Voir les notes <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {check.kind === 'idle' && (
          <p className="text-xs text-otter-200/60">
            Clique sur « Vérifier les mises à jour » pour comparer ta version locale à
            la dernière publiée sur GitHub. Rien n&apos;est téléchargé tant que tu ne le
            demandes pas.
          </p>
        )}
      </div>

      {/* Capture section */}
      <div className="glass glass-shine flex flex-col gap-5 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-otter-500/15 border border-otter-400/30 text-otter-300">
            <Video className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="text-lg font-semibold text-otter-50">Capture</h2>
        </div>

        <div className="flex flex-col gap-2.5">
          <label htmlFor="fps" className="text-xs font-semibold uppercase tracking-[0.15em] text-otter-300">
            Images par seconde
          </label>
          <div id="fps" className="flex gap-2">
            {[30, 60].map((value) => {
              const active = fps === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFps(value as CaptureConfig['fps'])}
                  className={`relative flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200
                    ${active
                      ? 'bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter ring-1 ring-otter-300/40'
                      : 'bg-white/[0.04] border border-white/[0.08] text-otter-200/80 hover:bg-white/[0.08] hover:text-otter-50'}
                  `}
                >
                  {active && (
                    <span className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/30 to-transparent pointer-events-none" aria-hidden />
                  )}
                  <span className="relative">{value} fps</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Capture hotkeys section */}
      <div className="glass glass-shine flex flex-col gap-5 rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-otter-500/15 border border-otter-400/30 text-otter-300">
              <Keyboard className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-otter-50">
                Raccourcis de capture
              </h2>
              <p className="text-xs text-otter-200/60">
                Raccourcis globaux, actifs même quand PresentOtter est en
                arrière-plan.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void resetHotkeys()}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] font-semibold text-otter-200/80 ring-1 ring-white/[0.1] transition hover:bg-white/[0.1] hover:text-otter-50"
            title="Restaurer Alt+Maj+S / Alt+Maj+R"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Défaut
          </button>
        </div>

        <HotkeyRow
          label="Capture photo"
          help="Ouvre le viseur (zone, plein écran)."
          combo={hotkeys?.capturePhoto ?? '—'}
          capturing={capturing === 'capturePhoto'}
          onStart={() => {
            setHkWarning(null)
            setCapturing('capturePhoto')
          }}
        />
        <HotkeyRow
          label="Vidéo de zone"
          help="Démarre le viseur, ou arrête l'enregistrement en cours."
          combo={hotkeys?.captureVideo ?? '—'}
          capturing={capturing === 'captureVideo'}
          onStart={() => {
            setHkWarning(null)
            setCapturing('captureVideo')
          }}
        />

        {hkWarning !== null && (
          <p className="flex items-center gap-2 text-xs text-sunray-300">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {hkWarning}
          </p>
        )}

        {/* Always-on background / startup */}
        <div className="flex items-start justify-between gap-4 border-t border-white/[0.06] pt-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-otter-50">
              Démarrer avec Windows
            </p>
            <p className="mt-0.5 text-xs text-otter-200/60">
              PresentOtter reste dans la barre système : les raccourcis de
              capture fonctionnent à tout moment, même sans fenêtre ouverte.
              Fermer la fenêtre ne quitte plus l&apos;app (clic droit sur
              l&apos;icône → Quitter).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={openAtLogin}
            onClick={() => void toggleStartup()}
            className={`relative mt-1 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              openAtLogin ? 'bg-kelp-500' : 'bg-white/[0.12]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                openAtLogin ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Export section */}
      <div className="glass glass-shine flex flex-col gap-5 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fur-500/15 border border-fur-400/30 text-fur-300">
            <Film className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h2 className="text-lg font-semibold text-otter-50">Export</h2>
        </div>

        <div className="flex flex-col gap-2.5">
          <label htmlFor="format" className="text-xs font-semibold uppercase tracking-[0.15em] text-otter-300">
            Format par défaut
          </label>
          <select
            id="format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="rounded-xl border border-white/[0.1] bg-white/[0.04] backdrop-blur-xl px-4 py-3 text-sm text-otter-50 outline-none transition-colors hover:bg-white/[0.08] focus:border-otter-400/50"
          >
            <option value="mp4" className="bg-deep-900">MP4 — universel</option>
            <option value="webm" className="bg-deep-900">WebM — web optimisé</option>
            <option value="gif" className="bg-deep-900">GIF — social</option>
          </select>
        </div>
      </div>
    </section>
  )
}

interface HotkeyRowProps {
  label: string
  help: string
  combo: string
  capturing: boolean
  onStart: () => void
}

function HotkeyRow({
  label,
  help,
  combo,
  capturing,
  onStart
}: HotkeyRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-otter-50">{label}</p>
        <p className="mt-0.5 text-xs text-otter-200/60">{help}</p>
      </div>
      <button
        type="button"
        onClick={onStart}
        className={`min-w-[150px] rounded-xl px-4 py-2 text-center text-sm font-semibold transition ${
          capturing
            ? 'bg-otter-500/20 text-otter-100 ring-2 ring-otter-400/50'
            : 'bg-white/[0.04] text-otter-50 ring-1 ring-white/[0.1] hover:bg-white/[0.08]'
        }`}
      >
        {capturing ? (
          <span className="text-xs text-otter-200/80">
            Appuie sur une combinaison…
          </span>
        ) : (
          <span className="font-mono">{formatCombo(combo)}</span>
        )}
      </button>
    </div>
  )
}
