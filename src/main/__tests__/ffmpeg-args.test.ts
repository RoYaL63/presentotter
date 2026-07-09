import { describe, it, expect } from 'vitest'
import {
  atempoChain,
  buildFfmpegArgs,
  clamp01,
  effectiveFade,
  normalizeSegments,
  sanitizeSegments,
  type VideoEditRequest
} from '../ffmpeg-args'

const base: VideoEditRequest = {
  inputPath: 'C:/in.mp4',
  segments: [],
  speed: 1,
  crop: null,
  transition: null,
  volume: 1,
  volumeZones: [],
  overlays: [],
  zoom: null,
  outputName: 'out'
}

const ZOOM = {
  cx: 0.5,
  cy: 0.5,
  zoom: 1.8,
  start: 1,
  end: 5,
  ramp: 0.6,
  outW: 810,
  outH: 268,
  fps: 30
}

const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

describe('clamp01', () => {
  it('clamps into [0,1] and treats non-finite as 0', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})

describe('normalizeSegments', () => {
  it('sorts, drops empty ranges and merges overlaps', () => {
    expect(
      normalizeSegments([
        { start: 8, end: 10 },
        { start: 0, end: 5 },
        { start: 4, end: 6 },
        { start: 2, end: 2 }
      ])
    ).toEqual([
      { start: 0, end: 6 },
      { start: 8, end: 10 }
    ])
  })
})

describe('sanitizeSegments', () => {
  it('preserves order and duplicates (the "dupliquer" feature)', () => {
    expect(
      sanitizeSegments([
        { start: 5, end: 10 },
        { start: 0, end: 3 },
        { start: 5, end: 10 },
        { start: 4, end: 4 }
      ])
    ).toEqual([
      { start: 5, end: 10 },
      { start: 0, end: 3 },
      { start: 5, end: 10 }
    ])
  })
})

describe('atempoChain', () => {
  it('passes a plain factor through in-range', () => {
    expect(atempoChain(1.5)).toBe('atempo=1.5000')
  })
  it('splits factors above 2 into stages', () => {
    expect(atempoChain(4)).toBe('atempo=2.0,atempo=2.0000')
  })
})

describe('buildFfmpegArgs — single/no segment', () => {
  it('no segments keeps the whole file with -c copy', () => {
    const args = buildFfmpegArgs(base, 'C:/out.mp4')
    expect(args).toContain('-c')
    expect(args).toContain('copy')
    expect(args).not.toContain('-filter_complex')
  })

  it('one segment stays lossless with -ss/-t + -c copy', () => {
    const args = buildFfmpegArgs({ ...base, segments: [{ start: 2, end: 10 }] }, 'C:/out.mp4')
    expect(args[args.indexOf('-ss') + 1]).toBe('2')
    expect(args[args.indexOf('-t') + 1]).toBe('8')
    expect(args).toContain('copy')
    expect(args[args.length - 1]).toBe('C:/out.mp4')
  })

  it('one segment + speed re-encodes with setpts + atempo', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 10 }], speed: 2 },
      'C:/out.mp4'
    )
    expect(args[args.indexOf('-vf') + 1]).toContain('setpts=PTS/2')
    expect(args[args.indexOf('-af') + 1]).toContain('atempo')
    expect(args).toContain('libx264')
  })
})

describe('buildFfmpegArgs — multi-segment concat (cut a passage)', () => {
  it('concatenates two kept ranges, dropping the gap', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 5 }, { start: 8, end: 20 }] },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[0:v]trim=start=0:end=5')
    expect(fc).toContain('[0:v]trim=start=8:end=20')
    expect(fc).toContain('concat=n=2:v=1:a=1[cv][ca]')
    expect(args).toContain('libx264')
    expect(args.filter((a) => a === '-map')).toHaveLength(2)
  })

  it('builds a video-only graph when there is no audio', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 5 }, { start: 8, end: 20 }] },
      'C:/out.mp4',
      false
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('concat=n=2:v=1:a=0[cv]')
    expect(fc).not.toContain('atrim')
    expect(args.filter((a) => a === '-map')).toHaveLength(1)
  })
})

describe('effectiveFade', () => {
  it('clamps to half the shortest segment', () => {
    expect(
      effectiveFade([{ start: 0, end: 10 }, { start: 12, end: 12.6 }], 1)
    ).toBeCloseTo(0.3)
  })
  it('returns 0 for a single segment or a non-positive request', () => {
    expect(effectiveFade([{ start: 0, end: 10 }], 1)).toBe(0)
    expect(effectiveFade([{ start: 0, end: 5 }, { start: 6, end: 10 }], 0)).toBe(0)
  })
  it('returns 0 when the feasible fade is negligible', () => {
    expect(
      effectiveFade([{ start: 0, end: 0.05 }, { start: 1, end: 1.05 }], 0.5)
    ).toBe(0)
  })
})

describe('buildFfmpegArgs — crossfade at joints', () => {
  const req: VideoEditRequest = {
    ...base,
    segments: [{ start: 0, end: 5 }, { start: 8, end: 20 }],
    transition: { duration: 0.5 }
  }

  it('joins with xfade + acrossfade instead of concat', () => {
    const args = buildFfmpegArgs(req, 'C:/out.mp4', true)
    const fc = args[args.indexOf('-filter_complex') + 1]
    // Offset = duration of first segment (5s) minus the fade (0.5s).
    expect(fc).toContain('xfade=transition=fade:duration=0.500:offset=4.500[cv]')
    expect(fc).toContain('acrossfade=d=0.500[ca]')
    expect(fc).not.toContain('concat=')
    // fps normalization required by xfade on VFR input.
    expect(fc).toContain('fps=60')
  })

  it('chains offsets across three segments (shrinking by one fade per joint)', () => {
    const args = buildFfmpegArgs(
      { ...req, segments: [{ start: 0, end: 5 }, { start: 8, end: 12 }, { start: 15, end: 18 }] },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    // Join 1 at 5 - 0.5 = 4.5 ; joined length 5 + 4 - 0.5 = 8.5 → join 2 at 8.0.
    expect(fc).toContain('offset=4.500[xv1]')
    expect(fc).toContain('offset=8.000[cv]')
  })

  it('skips audio fades on a soundless input', () => {
    const args = buildFfmpegArgs(req, 'C:/out.mp4', false)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('xfade=')
    expect(fc).not.toContain('acrossfade')
    expect(args.filter((a) => a === '-map')).toHaveLength(1)
  })
})

describe('buildFfmpegArgs — volume', () => {
  it('volume-only keeps the video stream copied and re-encodes just audio', () => {
    const args = buildFfmpegArgs({ ...base, volume: 1.5 }, 'C:/out.mp4', true)
    expect(args[args.indexOf('-af') + 1]).toBe('volume=1.50')
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy')
    expect(args).not.toContain('libx264')
  })

  it('uses opus for a .webm output and aac for .mp4', () => {
    const webm = buildFfmpegArgs({ ...base, volume: 0.5 }, 'C:/out.webm', true)
    expect(webm[webm.indexOf('-c:a') + 1]).toBe('libopus')
    expect(webm).not.toContain('-movflags')
    const mp4 = buildFfmpegArgs({ ...base, volume: 0.5 }, 'C:/out.mp4', true)
    expect(mp4[mp4.indexOf('-c:a') + 1]).toBe('aac')
    expect(mp4).toContain('-movflags')
  })

  it('applies volume as a post filter on the joined graph', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 5 }, { start: 8, end: 20 }], volume: 2 },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[ca]volume=2.00[outa]')
    expect(args).toContain('[outa]')
  })

  it('skips the volume filter on a soundless input', () => {
    const args = buildFfmpegArgs({ ...base, volume: 2 }, 'C:/out.mp4', false)
    expect(args).not.toContain('-af')
    const cIdx = args.indexOf('-c')
    expect(args[cIdx + 1]).toBe('copy')
  })
})

describe('buildFfmpegArgs — even dimensions (libx264 rejects odd sizes)', () => {
  it('appends the even-scale to every single-path video re-encode', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 10 }], speed: 2 },
      'C:/out.mp4'
    )
    const vf = args[args.indexOf('-vf') + 1]
    expect(vf?.endsWith(EVEN)).toBe(true)
  })

  it('appends the even-scale to the joined graph output', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 5 }, { start: 8, end: 20 }] },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain(`[cv]${EVEN}[outv]`)
    expect(args).toContain('[outv]')
  })

  it('does NOT touch pixels on a trim-only copy', () => {
    const args = buildFfmpegArgs({ ...base, segments: [{ start: 2, end: 10 }] }, 'C:/out.mp4')
    expect(args).not.toContain('-vf')
    expect(args).toContain('copy')
  })
})

describe('buildFfmpegArgs — volume zones (par sélection)', () => {
  const zone = { start: 1, end: 3, gain: 0.5 }

  it('whole file: stays on the fast path, video copied, gated volume filter', () => {
    const args = buildFfmpegArgs({ ...base, volumeZones: [zone] }, 'C:/out.mp4', true)
    expect(args[args.indexOf('-af') + 1]).toBe(
      "volume=0.50:enable='between(t,1.000,3.000)'"
    )
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy')
  })

  it('with a trim: joins through the filter graph, zones BEFORE atrim', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 5 }], volumeZones: [zone] },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain(
      "[0:a]volume=0.50:enable='between(t,1.000,3.000)',atrim=start=0:end=5"
    )
  })

  it('drops no-op zones (gain 100 %)', () => {
    const args = buildFfmpegArgs(
      { ...base, volumeZones: [{ start: 1, end: 3, gain: 1 }] },
      'C:/out.mp4',
      true
    )
    expect(args).not.toContain('-af')
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
  })
})

describe('buildFfmpegArgs — text overlays (PNG burn-in)', () => {
  const overlay = { path: 'C:/t0.png', start: 1, end: 4 }

  it('adds the PNG input and stamps it on [0:v] BEFORE the trims', () => {
    const args = buildFfmpegArgs(
      { ...base, segments: [{ start: 0, end: 10 }], overlays: [overlay] },
      'C:/out.mp4',
      true
    )
    expect(args[args.indexOf('C:/t0.png') - 1]).toBe('-i')
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain("[0:v][1:v]overlay=0:0:enable='between(t,1.000,4.000)'[ov0]")
    expect(fc).toContain('[ov0]trim=start=0:end=10')
  })

  it('splits the stamped stream when several segments consume it', () => {
    const args = buildFfmpegArgs(
      {
        ...base,
        segments: [{ start: 0, end: 5 }, { start: 8, end: 12 }],
        overlays: [overlay]
      },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[ov0]split=2[sv0][sv1]')
    expect(fc).toContain('[sv0]trim=start=0:end=5')
    expect(fc).toContain('[sv1]trim=start=8:end=12')
  })

  it('chains several overlays in order', () => {
    const args = buildFfmpegArgs(
      {
        ...base,
        segments: [{ start: 0, end: 10 }],
        overlays: [overlay, { path: 'C:/t1.png', start: 5, end: 9 }]
      },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[0:v][1:v]overlay')
    expect(fc).toContain('[ov0][2:v]overlay')
  })

  it('whole file + overlay: synthesizes an open-ended segment (no end=)', () => {
    const args = buildFfmpegArgs({ ...base, overlays: [overlay] }, 'C:/out.mp4', true)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[ov0]trim=start=0,setpts')
    expect(fc).not.toContain('end=Infinity')
    expect(args).toContain('libx264')
  })
})

describe('buildFfmpegArgs — animated zoom', () => {
  it('runs zoompan on [0:v] first, then trims from its output', () => {
    const args = buildFfmpegArgs({ ...base, zoom: ZOOM }, 'C:/out.mp4', true)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[0:v]fps=30,zoompan=')
    expect(fc).toContain('s=810x268')
    expect(fc).toContain('[zv]')
    // The (whole-file) trim branch consumes the zoom output, not raw [0:v].
    expect(fc).toContain('[zv]trim=start=0,setpts')
    expect(args).toContain('libx264')
  })

  it('splits the zoom output when several segments consume it', () => {
    const args = buildFfmpegArgs(
      { ...base, zoom: ZOOM, segments: [{ start: 0, end: 5 }, { start: 8, end: 12 }] },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[zv]split=2[sv0][sv1]')
  })

  it('places the zoom before overlays (label sits on top of the zoomed image)', () => {
    const args = buildFfmpegArgs(
      { ...base, zoom: ZOOM, overlays: [{ path: 'C:/t.png', start: 1, end: 3 }] },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc.indexOf('zoompan')).toBeLessThan(fc.indexOf('overlay='))
    expect(fc).toContain('[zv][1:v]overlay=')
  })

  it('clamps the ramp to half the window and forces a re-encode', () => {
    const args = buildFfmpegArgs(
      { ...base, zoom: { ...ZOOM, start: 2, end: 2.4, ramp: 5 } },
      'C:/out.mp4',
      true
    )
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('zoompan=')
    expect(args).toContain('libx264')
  })
})
