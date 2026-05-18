import { Film } from 'lucide-react'

interface VideoPreviewProps {
  label?: string
}

export function VideoPreview({ label = 'Preview' }: VideoPreviewProps) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
        <Film className="h-10 w-10" />
        <span className="text-sm uppercase tracking-widest">{label}</span>
      </div>
    </div>
  )
}
