/**
 * Pure ffmpeg argument construction for the video editor. Kept free of any
 * electron/node-fs imports so it can be unit-tested directly (video-editor.ts
 * pulls electron in, which isn't resolvable under vitest).
 */

/** Crop rectangle as fractions (0..1) of the source dimensions. */
export interface CropFraction {
  x: number
  y: number
  width: number
  height: number
}

/** A slice of the source timeline to KEEP, in seconds. */
export interface Segment {
  start: number
  end: number
}

export interface VideoEditRequest {
  /** Absolute path of the source file to edit. */
  inputPath: string
  /** ORDERED list of ranges to keep — order is respected and a range may
   *  appear twice (the "dupliquer" feature replays a passage). Removing a
   *  passage = leaving a gap between two segments. Empty = whole file. */
  segments: Segment[]
  /** Playback speed multiplier (1 = normal, 2 = 2×, 0.5 = half). */
  speed: number
  /** Optional crop, or null to keep the full frame. */
  crop: CropFraction | null
  /** Crossfade (fondu enchaîné) applied at every joint between kept
   *  segments, so a cut doesn't jump harshly. null/0 = hard cut. */
  transition: { duration: number } | null
  /** Audio gain multiplier (1 = unchanged, 0 = mute, 2 = +6 dB). */
  volume: number
  /** Per-range gain overrides, in SOURCE time — "baisse le son sur cette
   *  zone". Multiplies with the global volume. */
  volumeZones: VolumeZone[]
  /** Text/shape PNGs stamped over the frame, in SOURCE time. */
  overlays: OverlayInput[]
  /** Animated zoom into a region, or null. Applied on the source stream
   *  before overlays/trims (source time). */
  zoom: ZoomSpec | null
  /** Base file name (no extension) the user chose for the export. */
  outputName: string
}

/** A source-time range whose audio gain differs from the rest. */
export interface VolumeZone {
  start: number
  end: number
  gain: number
}

/** A full-frame transparent PNG stamped over the video during a source-time
 *  window — how on-video text (and future shapes) are burned in. PNG
 *  compositing beats drawtext on Windows: no fontconfig, no escaping hell,
 *  and the export matches the renderer's preview pixel for pixel. */
export interface OverlayInput {
  /** Absolute path of the transparent PNG (same size as the video frame). */
  path: string
  start: number
  end: number
}

/** Drop invalid overlay windows. */
export function sanitizeOverlays(overlays: OverlayInput[]): OverlayInput[] {
  return overlays.filter(
    (o) =>
      o.path.length > 0 &&
      Number.isFinite(o.start) &&
      Number.isFinite(o.end) &&
      o.end > o.start + 0.02
  )
}

/**
 * Animated zoom-into-a-region (Ken-Burns style, for tutorials). Resolved by
 * the renderer into a target center + zoom factor + source-time window. The
 * export uses ffmpeg's `zoompan` with a `time`-driven, smooth-stepped zoom
 * curve — validated end-to-end against real ffmpeg before shipping.
 */
export interface ZoomSpec {
  /** Target center, frame fractions. */
  cx: number
  cy: number
  /** Peak zoom factor during the hold (>1). */
  zoom: number
  /** Source-time window + ramp-in/out duration (seconds). */
  start: number
  end: number
  ramp: number
  /** Even output dims + frame rate the zoompan renders at. */
  outW: number
  outH: number
  fps: number
}

/** smoothstep(u) = 3u²−2u³, for eased ramps instead of robotic linear ones. */
function smoothstep(u: string): string {
  return `(${u})*(${u})*(3-2*(${u}))`
}

/**
 * ffmpeg filter chain for one animated zoom. `fps` normalizes the VFR
 * MediaRecorder timeline; `zoompan` zooms toward (cx,cy) following a curve
 * that ramps 1→zoom, holds, then zoom→1 across the window. x/y keep the
 * target centered and clamped inside the scaled frame.
 */
export function zoomFilterChain(z: ZoomSpec): string {
  const start = Math.max(0, z.start)
  const end = Math.max(start + 0.1, z.end)
  const half = (end - start) / 2
  const ramp = Math.max(0.05, Math.min(z.ramp, half - 0.01))
  const zoom = Math.max(1.05, z.zoom)
  const uin = `(time-${start})/${ramp}`
  const uout = `(time-${(end - ramp).toFixed(3)})/${ramp}`
  const zexpr =
    `if(lt(time,${start}),1,` +
    `if(lt(time,${(start + ramp).toFixed(3)}),1+(${zoom}-1)*${smoothstep(uin)},` +
    `if(lt(time,${(end - ramp).toFixed(3)}),${zoom},` +
    `if(lt(time,${end}),1+(${zoom}-1)*(1-${smoothstep(uout)}),1))))`
  const xexpr = `clip(${z.cx}*iw*zoom-ow/2,0,iw*zoom-ow)`
  const yexpr = `clip(${z.cy}*ih*zoom-oh/2,0,ih*zoom-oh)`
  return `fps=${z.fps},zoompan=z='${zexpr}':x='${xexpr}':y='${yexpr}':d=1:s=${z.outW}x${z.outH}:fps=${z.fps}`
}

/**
 * libx264 with yuv420p refuses odd dimensions, and the region recorder lets
 * the user drag ANY pixel rectangle (811×268 happens). Every re-encode path
 * must therefore end with this even-dimension scale, or the export dies with
 * "width not divisible by 2".
 */
const EVEN_SCALE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

/** Frame rate the xfade path normalizes to — xfade needs a steady frame
 *  rate on both inputs, and MediaRecorder output is variable-rate. */
export const XFADE_FPS = 60

/**
 * Clamp the requested crossfade so it never exceeds half the shortest kept
 * segment (acrossfade/xfade fail when the fade is longer than an input).
 * Returns 0 when a fade isn't feasible/meaningful.
 */
export function effectiveFade(segments: Segment[], requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0 || segments.length < 2) return 0
  const minDur = Math.min(...segments.map((s) => s.end - s.start))
  const fade = Math.min(requested, minDur / 2)
  return fade >= 0.05 ? fade : 0
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/**
 * Clean a clip list while PRESERVING its order and duplicates — the
 * "dupliquer" feature repeats a source range, and sorting/merging (see
 * normalizeSegments) would silently destroy that. Only drops invalid or
 * sub-perceptual ranges.
 */
export function sanitizeSegments(segments: Segment[]): Segment[] {
  return segments
    .map((s) => ({ start: Math.max(0, s.start), end: s.end }))
    .filter(
      (s) =>
        Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start + 0.02
    )
}

/**
 * Sort, clean and merge overlapping/adjacent kept segments. Drops zero/negative
 * ranges. The result is a disjoint, ordered list.
 */
export function normalizeSegments(segments: Segment[]): Segment[] {
  const valid = segments
    .map((s) => ({ start: Math.max(0, s.start), end: s.end }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start + 0.02)
    .sort((a, b) => a.start - b.start)
  const merged: Segment[] = []
  for (const s of valid) {
    const last = merged[merged.length - 1]
    if (last !== undefined && s.start <= last.end + 0.02) {
      last.end = Math.max(last.end, s.end)
    } else {
      merged.push({ ...s })
    }
  }
  return merged
}

/**
 * Chain atempo filters to reach an arbitrary speed — a single atempo only
 * covers 0.5..2.0, so we split the factor across several stages.
 */
export function atempoChain(speed: number): string {
  let remaining = speed
  const parts: string[] = []
  while (remaining > 2) {
    parts.push('atempo=2.0')
    remaining /= 2
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5')
    remaining *= 2
  }
  parts.push(`atempo=${remaining.toFixed(4)}`)
  return parts.join(',')
}

function cropExpr(crop: CropFraction): string {
  return `crop=iw*${clamp01(crop.width)}:ih*${clamp01(crop.height)}:iw*${clamp01(crop.x)}:ih*${clamp01(crop.y)}`
}

/** Audio encoder matching the output container — WebM only accepts
 *  Opus/Vorbis, MP4 wants AAC. */
function audioCodecFor(outputPath: string): string {
  return outputPath.toLowerCase().endsWith('.webm') ? 'libopus' : 'aac'
}

/** `-movflags` is an MP4/MOV muxer option; the WebM muxer rejects it. */
function pushOutput(args: string[], outputPath: string): string[] {
  if (outputPath.toLowerCase().endsWith('.mp4')) {
    args.push('-movflags', '+faststart')
  }
  args.push(outputPath)
  return args
}

/**
 * Single kept range (or the whole file). Trim-only stays lossless + fast via
 * `-c copy`; a crop/speed change re-encodes the video; a volume-only change
 * copies the video stream untouched and re-encodes just the audio.
 *
 * `zones` is only ever non-empty here when there is NO trim (segment null):
 * -ss input seeking resets timestamps, which would shift the zones' time
 * windows. Trimmed exports with zones go through buildJoined instead.
 */
function buildSingleSegment(
  inputPath: string,
  segment: Segment | null,
  crop: CropFraction | null,
  speed: number,
  volume: number,
  zones: VolumeZone[],
  outputPath: string,
  hasAudio: boolean
): string[] {
  const start = segment !== null ? Math.max(0, segment.start) : 0
  const duration = segment !== null && segment.end > start ? segment.end - start : 0

  const videoFilters: string[] = []
  if (crop !== null) videoFilters.push(cropExpr(crop))
  if (speed !== 1) videoFilters.push(`setpts=PTS/${speed}`)
  if (videoFilters.length > 0) videoFilters.push(EVEN_SCALE)
  const audioFilters: string[] = []
  if (hasAudio && zones.length > 0) audioFilters.push(zoneFilterChain(zones))
  if (hasAudio && speed !== 1) audioFilters.push(atempoChain(speed))
  if (hasAudio && volume !== 1) audioFilters.push(`volume=${volume.toFixed(2)}`)

  const args: string[] = ['-y']
  if (start > 0) args.push('-ss', String(start))
  if (duration > 0) args.push('-t', String(duration))
  args.push('-i', inputPath)
  if (videoFilters.length > 0) args.push('-vf', videoFilters.join(','))
  if (audioFilters.length > 0) args.push('-af', audioFilters.join(','))
  if (videoFilters.length > 0) {
    // Video pixels change → full re-encode.
    args.push(
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', audioCodecFor(outputPath), '-b:a', '160k'
    )
  } else if (audioFilters.length > 0) {
    // Audio-only change (volume) → keep the video stream bit-for-bit.
    args.push('-c:v', 'copy', '-c:a', audioCodecFor(outputPath), '-b:a', '160k')
  } else {
    args.push('-c', 'copy')
  }
  return pushOutput(args, outputPath)
}

/**
 * Multiple kept ranges → a single filter_complex that trims each range and
 * joins them (dropping the gaps), with optional crop/speed applied to the
 * joined stream. `hasAudio` decides whether the audio graph is built, so a
 * soundless recording doesn't fail on a missing [0:a].
 *
 * fadeDur > 0 joins with a crossfade (xfade + acrossfade) instead of a hard
 * concat: each joint dissolves from the end of one segment into the start of
 * the next, so a cut "recovers" smoothly instead of jumping.
 */
/** trim/atrim expression — omits `end` for an open range (whole file). */
function trimExpr(kind: 'trim' | 'atrim', seg: Segment): string {
  const end = Number.isFinite(seg.end) ? `:end=${seg.end}` : ''
  return `${kind}=start=${seg.start}${end}`
}

function buildJoined(
  inputPath: string,
  segments: Segment[],
  crop: CropFraction | null,
  speed: number,
  volume: number,
  zones: VolumeZone[],
  overlays: OverlayInput[],
  zoom: ZoomSpec | null,
  outputPath: string,
  hasAudio: boolean,
  fadeDur: number
): string[] {
  const parts: string[] = []
  const n = segments.length
  const useFade = fadeDur > 0 && n > 1
  let vSource = '0:v'
  // Animated zoom runs FIRST, on the raw source (source time), so overlays
  // sit on top of the zoomed image (a label stays fixed while the video
  // zooms under it) and trims still line up.
  if (zoom !== null) {
    parts.push(`[${vSource}]${zoomFilterChain(zoom)}[zv]`)
    vSource = 'zv'
  }
  // Text overlays gate on SOURCE time, so they stamp the stream BEFORE any
  // trim. The overlay PNGs are extra ffmpeg inputs 1..k; a single-frame PNG
  // input persists for the whole overlay (eof_action=repeat is the default).
  overlays.forEach((o, k) => {
    const out = `ov${k}`
    parts.push(
      `[${vSource}][${k + 1}:v]overlay=0:0:enable='between(t,${o.start.toFixed(3)},${o.end.toFixed(3)})'[${out}]`
    )
    vSource = out
  })
  // Whether the video source is now a filter OUTPUT (zoom or overlay
  // produced it) rather than the raw [0:v] input. A filter output label is
  // single-use, so n trim branches need an explicit split; raw [0:v] can be
  // reused directly.
  const vIsFiltered = zoom !== null || overlays.length > 0
  if (vIsFiltered && n > 1) {
    parts.push(`[${vSource}]split=${n}${segments.map((_, i) => `[sv${i}]`).join('')}`)
  }
  const vSrcFor = (i: number): string =>
    vIsFiltered ? (n > 1 ? `sv${i}` : vSource) : '0:v'
  // Zone gains gate on SOURCE time too, so they run before each atrim.
  const aPre = hasAudio && zones.length > 0 ? `${zoneFilterChain(zones)},` : ''
  segments.forEach((seg, i) => {
    const vChain = [trimExpr('trim', seg), 'setpts=PTS-STARTPTS']
    // xfade needs both inputs at the same steady frame rate; MediaRecorder
    // output is variable-rate, so normalize when fading.
    if (useFade) vChain.push(`fps=${XFADE_FPS}`)
    parts.push(`[${vSrcFor(i)}]${vChain.join(',')}[v${i}]`)
    if (hasAudio) {
      parts.push(`[0:a]${aPre}${trimExpr('atrim', seg)},asetpts=PTS-STARTPTS[a${i}]`)
    }
  })
  if (useFade) {
    // Chain pairwise: [v0][v1]xfade[x1]; [x1][v2]xfade[x2]; … The offset of
    // each fade is relative to the ALREADY-JOINED stream, whose duration
    // shrinks by fadeDur at every joint.
    let prevV = 'v0'
    let prevA = 'a0'
    let acc = segments[0] !== undefined ? segments[0].end - segments[0].start : 0
    for (let i = 1; i < n; i++) {
      const seg = segments[i]
      if (seg === undefined) continue
      const off = Math.max(0, acc - fadeDur)
      const vOut = i === n - 1 ? 'cv' : `xv${i}`
      parts.push(
        `[${prevV}][v${i}]xfade=transition=fade:duration=${fadeDur.toFixed(3)}:offset=${off.toFixed(3)}[${vOut}]`
      )
      prevV = vOut
      if (hasAudio) {
        const aOut = i === n - 1 ? 'ca' : `xa${i}`
        parts.push(`[${prevA}][a${i}]acrossfade=d=${fadeDur.toFixed(3)}[${aOut}]`)
        prevA = aOut
      }
      acc = acc + (seg.end - seg.start) - fadeDur
    }
  } else {
    const concatInputs = segments
      .map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`))
      .join('')
    parts.push(
      `${concatInputs}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[cv]${hasAudio ? '[ca]' : ''}`
    )
  }

  // Post-processing (crop / speed) on the joined stream. EVEN_SCALE is
  // unconditional: this path always re-encodes with libx264, which rejects
  // odd source dimensions (region captures can be e.g. 811px wide).
  let vLabel = 'cv'
  let aLabel = 'ca'
  const vPost: string[] = []
  if (crop !== null) vPost.push(cropExpr(crop))
  if (speed !== 1) vPost.push(`setpts=PTS/${speed}`)
  vPost.push(EVEN_SCALE)
  parts.push(`[cv]${vPost.join(',')}[outv]`)
  vLabel = 'outv'
  const aPost: string[] = []
  if (speed !== 1) aPost.push(atempoChain(speed))
  if (volume !== 1) aPost.push(`volume=${volume.toFixed(2)}`)
  if (hasAudio && aPost.length > 0) {
    parts.push(`[ca]${aPost.join(',')}[outa]`)
    aLabel = 'outa'
  }

  const args = [
    '-y',
    '-i', inputPath,
    ...overlays.flatMap((o) => ['-i', o.path]),
    '-filter_complex', parts.join(';'),
    '-map', `[${vLabel}]`
  ]
  if (hasAudio) args.push('-map', `[${aLabel}]`)
  args.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', audioCodecFor(outputPath), '-b:a', '160k'] : [])
  )
  return pushOutput(args, outputPath)
}

/** Clamp the audio gain to a sane [0, 4] window (0 = mute, 4 = +12 dB). */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.max(0, Math.min(4, v))
}

/** Drop no-op / invalid zones, clamp the gains. Order is irrelevant (each
 *  zone gates on its own time window). */
export function sanitizeZones(zones: VolumeZone[]): VolumeZone[] {
  return zones
    .map((z) => ({ start: Math.max(0, z.start), end: z.end, gain: clampVolume(z.gain) }))
    .filter(
      (z) =>
        Number.isFinite(z.start) &&
        Number.isFinite(z.end) &&
        z.end > z.start + 0.02 &&
        z.gain !== 1
    )
}

/**
 * One gated volume filter per zone. `enable='between(t,a,b)'` works in the
 * INPUT's time base, so this chain must run on [0:a] BEFORE any atrim —
 * after a trim the timestamps restart at 0 and the windows would land on
 * the wrong audio.
 */
function zoneFilterChain(zones: VolumeZone[]): string {
  return zones
    .map(
      (z) =>
        `volume=${z.gain.toFixed(2)}:enable='between(t,${z.start.toFixed(3)},${z.end.toFixed(3)})'`
    )
    .join(',')
}

/**
 * Whether the edit re-encodes the VIDEO stream (joins several ranges, crops,
 * or changes speed). Trim-only and volume-only edits keep the video stream
 * bit-for-bit. Callers use this to pick the output container: a video
 * re-encode is H.264, which is invalid in a .webm wrapper, so the output
 * must be .mp4 in that case.
 */
export function willReencode(req: VideoEditRequest): boolean {
  const speed = req.speed > 0 ? req.speed : 1
  const nSegs = sanitizeSegments(req.segments).length
  const nZones = sanitizeZones(req.volumeZones).length
  // Volume zones on a TRIMMED export go through the joined graph (video
  // re-encode); zones on the whole file keep the video copied. Overlays
  // always burn pixels → always re-encode.
  return (
    nSegs > 1 ||
    req.crop !== null ||
    speed !== 1 ||
    (nZones > 0 && nSegs >= 1) ||
    sanitizeOverlays(req.overlays).length > 0 ||
    req.zoom !== null
  )
}

/**
 * Build the ffmpeg argument list for an edit request. One kept range (or none)
 * uses the fast single-segment path; several kept ranges are joined — with a
 * crossfade at each joint when a transition is requested, hard concat
 * otherwise. Order and duplicates in `segments` are respected.
 */
export function buildFfmpegArgs(
  req: VideoEditRequest,
  outputPath: string,
  hasAudio = true
): string[] {
  const segs = sanitizeSegments(req.segments)
  const speed = req.speed > 0 ? req.speed : 1
  const volume = clampVolume(req.volume)
  const zones = sanitizeZones(req.volumeZones)
  const overlays = sanitizeOverlays(req.overlays)
  // Zones/overlays/zoom + a trim must go through the filter graph (trim/atrim
  // preserve the source time their windows gate on; -ss would shift them).
  // Zones on the whole file (no segments) stay on the fast single path;
  // overlays/zoom always need filter_complex.
  const needsGraph =
    segs.length > 1 ||
    (zones.length > 0 && segs.length === 1) ||
    overlays.length > 0 ||
    req.zoom !== null
  if (!needsGraph) {
    return buildSingleSegment(
      req.inputPath, segs[0] ?? null, req.crop, speed, volume, zones, outputPath, hasAudio
    )
  }
  // Overlays/zoom on an untouched timeline: synthesize one open-ended segment
  // so the joined graph has a branch to hang the trims on.
  const list = segs.length > 0 ? segs : [{ start: 0, end: Infinity }]
  const fade = effectiveFade(segs, req.transition?.duration ?? 0)
  return buildJoined(
    req.inputPath, list, req.crop, speed, volume, zones, overlays, req.zoom, outputPath, hasAudio, fade
  )
}
