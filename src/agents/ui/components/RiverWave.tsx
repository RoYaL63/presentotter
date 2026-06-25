/**
 * River wave — the OtterMorphisme modal header signature (guide §12).
 * Two crossed, slowly drifting SVG waves give a calm "water surface"
 * band at the top of a modal without adding visual weight.
 *
 * Designed to be dropped as the FIRST child of a `p-5` modal card; the
 * negative margins bleed it to the card edges and `topClass` matches the
 * card's top corner radius.
 */
export function RiverWave({
  topClass = 'rounded-t-2xl'
}: {
  topClass?: string
}): JSX.Element {
  return (
    <div
      className={`-mx-5 -mt-5 mb-4 h-4 overflow-hidden ${topClass}`}
      aria-hidden
    >
      <svg
        viewBox="0 0 660 16"
        preserveAspectRatio="none"
        className="river-wave-a"
        style={{ width: '200%', height: 16, display: 'block' }}
      >
        <path
          d="M0 10 Q82 2 165 10 T330 6 T495 12 T660 6 V16 H0Z"
          fill="rgba(43,217,172,0.32)"
        />
      </svg>
      <svg
        viewBox="0 0 660 16"
        preserveAspectRatio="none"
        className="river-wave-b"
        style={{ width: '200%', height: 16, marginTop: -16, display: 'block' }}
      >
        <path
          d="M0 12 Q110 4 220 12 T440 8 T660 12 V16 H0Z"
          fill="rgba(59,230,192,0.18)"
        />
      </svg>
    </div>
  )
}
