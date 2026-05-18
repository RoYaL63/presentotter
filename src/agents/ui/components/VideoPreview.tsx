import { Film } from 'lucide-react'

interface VideoPreviewProps {
  label?: string
}

export function VideoPreview({ label = 'Preview' }: VideoPreviewProps) {
  return (
    <div className="glass glass-shine relative aspect-video w-full overflow-hidden rounded-2xl">
      {/* Inner deep gradient — gives depth to the empty preview */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-deep-900/60 via-deep-950/40 to-deep-900/60"
        aria-hidden
      />

      {/* Subtle grid pattern for visual texture */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }}
        aria-hidden
      />

      {/* Centered placeholder */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3 text-otter-200/40">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-xl">
          <Film className="h-7 w-7" strokeWidth={1.5} />
          <span
            className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/15 to-transparent pointer-events-none"
            aria-hidden
          />
        </div>
        <span className="text-xs font-medium uppercase tracking-[0.2em]">{label}</span>
      </div>

      {/* Corner glow accents */}
      <div
        className="absolute -left-20 -top-20 h-40 w-40 rounded-full bg-otter-500/20 blur-3xl pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute -right-20 -bottom-20 h-40 w-40 rounded-full bg-fur-500/15 blur-3xl pointer-events-none"
        aria-hidden
      />
    </div>
  )
}
