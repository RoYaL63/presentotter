import { useMemo } from 'react'
import {
  ArrowUpRight,
  Circle,
  Crosshair,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Square,
  Sun,
  Type
} from 'lucide-react'
import {
  useToolSettingsStore,
  type CursorStyle,
  type ToolId
} from '../stores/useToolSettingsStore'

/**
 * Tools page — one card per drawing tool with a French description, the
 * default color / thickness / opacity, plus a global Cursor section.
 *
 * All edits persist via useToolSettingsStore (localStorage). The Toolbar
 * reads these defaults when the user switches tools, so the preferred
 * config travels across sessions and across screen-share runs.
 */

interface ToolDef {
  id: ToolId
  label: string
  Icon: typeof Pencil
  shortcut: string
  description: string
  bullets: string[]
  /** True if strokeWidth is treated as font-size (for the text tool). */
  strokeIsFontSize?: boolean
}

const TOOLS: ToolDef[] = [
  {
    id: 'pencil',
    label: 'Crayon',
    Icon: Pencil,
    shortcut: 'Alt+P',
    description: 'Trace libre, lissé par interpolation quadratique entre les points.',
    bullets: [
      'Idéal pour entourer ou souligner à main levée',
      'Le trait s\'épaissit avec la valeur "px"',
      'Cliquer sans bouger trace un point rond'
    ]
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    Icon: Square,
    shortcut: 'Alt+R',
    description: 'Cadre rectangulaire vide pour encadrer un bouton, un paragraphe, etc.',
    bullets: [
      'Glisser depuis un coin pour fixer la taille',
      'Seul le contour est tracé (pas de remplissage)'
    ]
  },
  {
    id: 'circle',
    label: 'Cercle',
    Icon: Circle,
    shortcut: 'Alt+O',
    description: 'Ellipse inscrite dans le rectangle de sélection.',
    bullets: [
      'Glisser pour tracer un cercle ou une ellipse',
      'Contour uniquement, parfait pour marquer un point d\'intérêt'
    ]
  },
  {
    id: 'arrow',
    label: 'Flèche',
    Icon: ArrowUpRight,
    shortcut: 'Alt+A',
    description: 'Flèche directionnelle avec pointe pleine, taillée selon la valeur "px".',
    bullets: [
      'Glisser de l\'origine vers la cible',
      'La pointe grossit proportionnellement à l\'épaisseur'
    ]
  },
  {
    id: 'text',
    label: 'Texte',
    Icon: Type,
    shortcut: 'Alt+T',
    description: 'Insertion d\'une note texte ancrée à un point précis.',
    bullets: [
      'Cliquer ouvre un champ flottant à cet endroit',
      'Entrée valide · Échap annule',
      'La valeur "px" sert de taille de police de base'
    ],
    strokeIsFontSize: true
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    Icon: Sun,
    shortcut: 'Alt+L',
    description: 'Assombrit le reste de l\'écran et met en évidence une zone circulaire.',
    bullets: [
      'Glisser depuis le centre pour fixer le rayon',
      'L\'opacité règle l\'intensité du voile sombre',
      'Idéal pour focaliser l\'attention pendant une démo'
    ]
  }
]

const COLOR_SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22d3ee',
  '#3b82f6',
  '#a855f7',
  '#ffffff'
]

export function Tools() {
  const defaults = useToolSettingsStore((s) => s.defaults)
  const cursor = useToolSettingsStore((s) => s.cursor)
  const sanitizer = useToolSettingsStore((s) => s.sanitizer)
  const ephemeral = useToolSettingsStore((s) => s.ephemeral)
  const setToolColor = useToolSettingsStore((s) => s.setToolColor)
  const setToolStroke = useToolSettingsStore((s) => s.setToolStroke)
  const setToolOpacity = useToolSettingsStore((s) => s.setToolOpacity)
  const setCursor = useToolSettingsStore((s) => s.setCursor)
  const setSanitizer = useToolSettingsStore((s) => s.setSanitizer)
  const setEphemeral = useToolSettingsStore((s) => s.setEphemeral)
  const resetAll = useToolSettingsStore((s) => s.resetAll)

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 lg:p-12">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-4xl font-bold tracking-tight text-otter-50">Outils</h1>
          <p className="text-base text-otter-200/70">
            Détails de chaque outil et configuration par défaut (couleur, épaisseur, opacité).
            Les valeurs choisies ici s\'appliquent dès que tu sélectionnes l\'outil dans la
            toolbar flottante.
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="btn-glass mt-1 whitespace-nowrap"
          title="Restaurer les valeurs d'usine"
        >
          <RotateCcw className="h-4 w-4" />
          <span>Réinitialiser</span>
        </button>
      </header>

      {/* Tools grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {TOOLS.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            value={defaults[tool.id]}
            onColor={(hex) => setToolColor(tool.id, hex)}
            onStroke={(w) => setToolStroke(tool.id, w)}
            onOpacity={(o) => setToolOpacity(tool.id, o)}
          />
        ))}
      </div>

      {/* Cursor section */}
      <div className="glass glass-shine flex flex-col gap-5 rounded-2xl p-6">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-otter-500/15 border border-otter-400/30 text-otter-300">
            <Crosshair className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-otter-50">Curseur en évidence</h2>
            <p className="text-xs text-otter-200/60">
              Le halo et la traînée qui suivent ton curseur sur tous les écrans.
            </p>
          </div>
        </header>

        {/* Cursor style */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-[0.15em] text-otter-300">
            Style de traînée
          </label>
          <div className="flex gap-2">
            {(['meteor', 'classic', 'minimal'] as CursorStyle[]).map((style) => {
              const active = cursor.style === style
              const labels: Record<CursorStyle, string> = {
                meteor: 'Météorite',
                classic: 'Classique',
                minimal: 'Minimal'
              }
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => setCursor({ style })}
                  className={`relative flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                    active
                      ? 'bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter ring-1 ring-otter-300/40'
                      : 'bg-white/[0.04] border border-white/[0.08] text-otter-200/80 hover:bg-white/[0.08] hover:text-otter-50'
                  }`}
                >
                  <span className="relative">{labels[style]}</span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-otter-200/50">
            <strong className="text-otter-200">Météorite</strong> : 4 passes lissées, halo
            radial, queue qui s\'estompe progressivement. <strong className="text-otter-200">Classique</strong> : trait simple.
            <strong className="text-otter-200"> Minimal</strong> : juste un point de focale.
          </p>
        </div>

        {/* Cursor color */}
        <ColorRow
          label="Couleur"
          value={cursor.color}
          onChange={(hex) => setCursor({ color: hex })}
        />

        {/* Trail length */}
        <SliderRow
          label="Durée de la traînée"
          unit="ms"
          min={120}
          max={3000}
          step={20}
          value={cursor.trailLengthMs}
          onChange={(v) => setCursor({ trailLengthMs: v })}
        />

        {/* Intensity */}
        <SliderRow
          label="Intensité"
          unit="%"
          min={0}
          max={100}
          step={1}
          value={Math.round(cursor.intensity * 100)}
          onChange={(v) => setCursor({ intensity: v / 100 })}
        />
      </div>

      {/* Ephemeral highlighter — how long each stroke stays visible. */}
      <div className="glass glass-shine flex flex-col gap-4 rounded-2xl p-6">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunray-500/15 border border-sunray-400/30 text-sunray-300">
            <Crosshair className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-otter-50">
              Surligneur éphémère
            </h2>
            <p className="text-xs text-otter-200/60">
              Le tracé s&apos;estompe progressivement, du premier coup de crayon
              vers le dernier, puis disparaît.
            </p>
          </div>
        </header>

        <SliderRow
          label="Temps avant disparition"
          unit="s"
          min={2}
          max={20}
          step={1}
          value={Math.round(ephemeral.lifeMs / 1000)}
          onChange={(v) => setEphemeral({ lifeMs: v * 1000 })}
        />
        <p className="text-xs text-otter-200/55">
          Chaque point du tracé a son propre âge : les premiers coups de
          crayon disparaissent avant les derniers. La phase de fondu prend
          environ un tiers de la durée totale. Modifier la valeur n&apos;affecte
          que les prochains tracés ; ceux déjà à l&apos;écran finissent avec
          leur durée d&apos;origine.
        </p>
      </div>

      {/* Sanitizer section — controls for the live OCR scanner that runs
          when the radar in the toolbar is on. */}
      <div className="glass glass-shine flex flex-col gap-4 rounded-2xl p-6">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral-500/15 border border-coral-400/30 text-coral-500">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-otter-50">Sanitizer LIVE</h2>
            <p className="text-xs text-otter-200/60">
              Masquage en direct des secrets sur l&apos;écran partagé.
            </p>
          </div>
        </header>

        {/* Detection engine */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-[0.15em] text-otter-300">
            Méthode de détection
          </label>
          <div className="flex gap-2">
            {(
              [
                { id: 'hybrid', label: 'Hybride', hint: 'UI + OCR' },
                { id: 'uia', label: 'UI Windows', hint: 'Rapide' },
                { id: 'ocr', label: 'OCR', hint: 'Universel' }
              ] as const
            ).map((opt) => {
              const active = sanitizer.detectionMode === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSanitizer({ detectionMode: opt.id })}
                  className={`relative flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                    active
                      ? 'bg-gradient-to-br from-otter-400 to-otter-600 text-white shadow-glow-otter ring-1 ring-otter-300/40'
                      : 'bg-white/[0.04] border border-white/[0.08] text-otter-200/80 hover:bg-white/[0.08] hover:text-otter-50'
                  }`}
                >
                  <span className="block">{opt.label}</span>
                  <span className={`block text-[10px] ${active ? 'text-white/80' : 'text-otter-200/50'}`}>
                    {opt.hint}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-otter-200/50">
            <strong className="text-otter-200">UI Windows</strong> lit
            directement les champs de la fenêtre active (instantané, léger),
            mais ne voit pas le texte rendu en image (pages web, canvas).{' '}
            <strong className="text-otter-200">OCR</strong> lit tous les pixels
            mais reste plus lent. <strong className="text-otter-200">Hybride</strong> combine les deux (recommandé). Changement pris en compte au prochain démarrage du radar LIVE.
          </p>
        </div>

        <SanitizerToggle
          label="Détection contextuelle"
          help='Masque la valeur 6+ caractères qui suit un libellé comme "secret", "mot de passe", "token", "credential", "key" sur la même ligne (FR + EN). Désactive si tu vois trop de faux positifs.'
          value={sanitizer.contextual}
          onChange={(v) => setSanitizer({ contextual: v })}
        />

        <SanitizerToggle
          label="Mode debug OCR"
          help="Encadre chaque mot que Tesseract lit, en kelp. Utile pour vérifier si le sanitizer a bien vu le texte qui n'a pas été masqué. Diagnostic uniquement."
          value={sanitizer.debugOcr}
          onChange={(v) => setSanitizer({ debugOcr: v })}
        />
      </div>
    </section>
  )
}

interface SanitizerToggleProps {
  label: string
  help: string
  value: boolean
  onChange(v: boolean): void
}

function SanitizerToggle({ label, help, value, onChange }: SanitizerToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm font-semibold text-otter-50">{label}</p>
        <p className="mt-0.5 text-xs leading-snug text-otter-200/60">{help}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-coral-500' : 'bg-white/[0.12]'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

interface ToolCardProps {
  tool: ToolDef
  value: { color: string; strokeWidth: number; opacity: number }
  onColor(hex: string): void
  onStroke(width: number): void
  onOpacity(opacity: number): void
}

function ToolCard({ tool, value, onColor, onStroke, onOpacity }: ToolCardProps) {
  const Icon = tool.Icon
  return (
    <article className="glass glass-shine flex flex-col gap-4 rounded-2xl p-5">
      <header className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl shadow-glow-otter ring-1 ring-otter-300/40"
          style={{
            background: `linear-gradient(135deg, ${value.color}, ${value.color}dd)`,
            color: '#fff'
          }}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-otter-50">{tool.label}</h3>
            <kbd className="rounded bg-white/[0.06] border border-white/[0.1] px-1.5 py-0.5 font-mono text-[10px] text-otter-200">
              {tool.shortcut}
            </kbd>
          </div>
          <p className="mt-0.5 text-xs text-otter-200/70">{tool.description}</p>
        </div>
      </header>

      <ul className="flex flex-col gap-1 text-xs text-otter-200/60">
        {tool.bullets.map((b) => (
          <li key={b} className="flex items-start gap-1.5">
            <span className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-otter-400" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-3.5">
        <ColorRow label="Couleur" value={value.color} onChange={onColor} compact />
        <SliderRow
          label={tool.strokeIsFontSize === true ? 'Taille' : 'Épaisseur'}
          unit="px"
          min={1}
          max={32}
          step={1}
          value={value.strokeWidth}
          onChange={onStroke}
          compact
        />
        <SliderRow
          label="Opacité"
          unit="%"
          min={0}
          max={100}
          step={1}
          value={Math.round(value.opacity * 100)}
          onChange={(v) => onOpacity(v / 100)}
          compact
        />
      </div>
    </article>
  )
}

interface ColorRowProps {
  label: string
  value: string
  onChange(hex: string): void
  compact?: boolean
}

function ColorRow({ label, value, onChange, compact = false }: ColorRowProps) {
  return (
    <div className={`flex items-center ${compact ? 'gap-3' : 'gap-4'}`}>
      <span
        className={`${compact ? 'w-20 text-[10px]' : 'w-32 text-xs'} font-semibold uppercase tracking-[0.15em] text-otter-300`}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        {COLOR_SWATCHES.map((hex) => {
          const active = hex.toLowerCase() === value.toLowerCase()
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              aria-pressed={active}
              title={hex}
              className={`h-5 w-5 rounded-full transition-all duration-200 ${
                active
                  ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-deep-900 scale-110'
                  : 'ring-1 ring-white/25 hover:scale-105'
              }`}
              style={{ backgroundColor: hex }}
            />
          )
        })}
        <label
          className="ml-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-white/[0.06]"
          title="Choisir une couleur libre"
        >
          <span
            className="h-3.5 w-3.5 rounded-full ring-1 ring-white/40"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="sr-only"
          />
        </label>
      </div>
    </div>
  )
}

interface SliderRowProps {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange(value: number): void
  compact?: boolean
}

function SliderRow({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  compact = false
}: SliderRowProps) {
  // Display formatting — keeps the readout stable width
  const display = useMemo(() => {
    if (unit === '%') return `${value}%`
    if (unit === 'ms') return `${value} ms`
    return `${value} ${unit}`
  }, [unit, value])

  return (
    <div className={`flex items-center ${compact ? 'gap-3' : 'gap-4'}`}>
      <span
        className={`${compact ? 'w-20 text-[10px]' : 'w-32 text-xs'} font-semibold uppercase tracking-[0.15em] text-otter-300`}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-1.5 flex-1 cursor-pointer accent-otter-400"
      />
      <span className="w-16 text-right font-mono text-xs text-otter-200 tabular-nums">
        {display}
      </span>
    </div>
  )
}
