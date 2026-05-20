import mascotUrl from '../../../renderer/assets/mascot.webp'

/**
 * Otterwise mascot — the friendly presenter loutre that headlines the
 * brand. Used in Home (large hero) and Toolbar (small chip) in place of
 * the previous 🦦 emoji.
 *
 * The image is a transparent .webp shipped in src/renderer/assets/ and
 * pulled in via a Vite asset import so it gets a content-hashed filename
 * in production builds (cache-friendly).
 */
interface MascotProps {
  /** Visual size in px (sets both width & height; image is square-ish). */
  size?: number
  /** Add a bubble float animation. */
  animate?: boolean
  /** ARIA label override; defaults to a friendly French description. */
  alt?: string
  className?: string
}

export function Mascot({ size = 48, animate = false, alt, className }: MascotProps) {
  return (
    <img
      src={mascotUrl}
      alt={alt ?? 'Mascotte PresentOtter — loutre présentatrice'}
      width={size}
      height={size}
      draggable={false}
      className={[
        'pointer-events-none select-none drop-shadow-[0_4px_12px_rgba(27,94,123,0.25)]',
        animate ? 'animate-bubble-slow' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  )
}
