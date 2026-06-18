import { create } from 'zustand'

/**
 * Persistent per-tool defaults + cursor highlight preferences.
 *
 * Stored in localStorage under `presentotter:tool-settings:v1`. The Tools
 * page (inside Home) edits these values; the floating Toolbar reads them
 * when the user switches tools so the preferred color / thickness /
 * opacity travels across sessions.
 *
 * Cross-window sync — every Electron BrowserWindow runs an isolated
 * renderer process with its own zustand store instance, but they all
 * share the same default session and therefore the same localStorage.
 * When the Tools page writes, we re-broadcast the new state to every
 * sibling window through the standard `storage` DOM event so the
 * Toolbar updates its UI without a restart.
 *
 * Schema is versioned in the key (`:v1`) so future migrations can detect
 * old payloads and reset cleanly.
 */

export type ToolId =
  | 'pencil'
  | 'ephemeral'
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'text'
  | 'spotlight'

export interface ToolDefaults {
  color: string
  strokeWidth: number
  opacity: number
}

export type CursorStyle = 'meteor' | 'classic' | 'minimal'

export interface CursorSettings {
  color: string
  style: CursorStyle
  /** ms — how long a sample stays visible in the trail. */
  trailLengthMs: number
  /** 0..1 — overall opacity multiplier of the trail. */
  intensity: number
  /** 0.5..2.0 — multiplier on the halo radius + particle base size. */
  size: number
}

export interface SanitizerSettings {
  /** Show each OCR-detected word as a small box on the overlay so the
   *  user can see what Tesseract is reading. Off by default — it's a
   *  diagnostic tool, not part of the normal UX. */
  debugOcr: boolean
  /** Catch values next to a "secret / mot de passe / token / key / …"
   *  label even when the value doesn't match a known credential format. */
  contextual: boolean
}

export interface EphemeralSettings {
  /** Visible lifetime of each ephemeral stroke point, in ms.
   *  The user-facing "temps avant disparition" slider, clamped to
   *  a sensible range so the rAF prune loop can't blow up. */
  lifeMs: number
}

export interface ToolSettingsState {
  defaults: Record<ToolId, ToolDefaults>
  cursor: CursorSettings
  sanitizer: SanitizerSettings
  ephemeral: EphemeralSettings
  setToolColor(tool: ToolId, hex: string): void
  setToolStroke(tool: ToolId, width: number): void
  setToolOpacity(tool: ToolId, opacity: number): void
  setCursor(patch: Partial<CursorSettings>): void
  setSanitizer(patch: Partial<SanitizerSettings>): void
  setEphemeral(patch: Partial<EphemeralSettings>): void
  resetAll(): void
}

const STORAGE_KEY = 'presentotter:tool-settings:v1'

// Factory defaults built around the otter-morphism palette: coral for
// emphasis tools, deep-sea for structure shapes, cream for text accents,
// sunray for spotlight focus. Users can override any of these in Outils.
const FACTORY_DEFAULTS: Record<ToolId, ToolDefaults> = {
  pencil: { color: '#FF8B7B', strokeWidth: 4, opacity: 1 }, // coral pop
  ephemeral: { color: '#FFC857', strokeWidth: 5, opacity: 1 }, // sunray glow
  rectangle: { color: '#1B5E7B', strokeWidth: 3, opacity: 1 }, // deep-sea
  circle: { color: '#4A7C59', strokeWidth: 3, opacity: 1 }, // kelp green
  arrow: { color: '#FF8B7B', strokeWidth: 5, opacity: 1 }, // coral pop
  text: { color: '#F5E6D3', strokeWidth: 6, opacity: 1 }, // cream
  spotlight: { color: '#FFC857', strokeWidth: 4, opacity: 0.6 } // sunray
}

const FACTORY_CURSOR: CursorSettings = {
  color: '#FF8B7B', // coral pop — signature CTA accent
  style: 'meteor',
  trailLengthMs: 900,
  intensity: 1,
  size: 1
}

const FACTORY_SANITIZER: SanitizerSettings = {
  debugOcr: false,
  // Contextual detection is on by default — a strict regex-only mode
  // misses too many real-world cases (Cloud Console "Code secret du
  // client", admin dashboards, etc.).
  contextual: true
}

const FACTORY_EPHEMERAL: EphemeralSettings = {
  lifeMs: 5000
}

interface PersistedShape {
  defaults: Record<ToolId, ToolDefaults>
  cursor: CursorSettings
  sanitizer: SanitizerSettings
  ephemeral: EphemeralSettings
}

function emptyShape(): PersistedShape {
  return {
    defaults: { ...FACTORY_DEFAULTS },
    cursor: { ...FACTORY_CURSOR },
    sanitizer: { ...FACTORY_SANITIZER },
    ephemeral: { ...FACTORY_EPHEMERAL }
  }
}

function loadFromStorage(): PersistedShape {
  if (typeof localStorage === 'undefined') return emptyShape()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return emptyShape()
    return parsePersisted(raw)
  } catch {
    return emptyShape()
  }
}

function parsePersisted(raw: string): PersistedShape {
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object') return emptyShape()
  const candidate = parsed as Partial<PersistedShape>
  return {
    defaults: { ...FACTORY_DEFAULTS, ...(candidate.defaults ?? {}) },
    cursor: { ...FACTORY_CURSOR, ...(candidate.cursor ?? {}) },
    sanitizer: { ...FACTORY_SANITIZER, ...(candidate.sanitizer ?? {}) },
    ephemeral: { ...FACTORY_EPHEMERAL, ...(candidate.ephemeral ?? {}) }
  }
}

function persist(state: PersistedShape): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage full / blocked — silent
  }
}

export const useToolSettingsStore = create<ToolSettingsState>((set) => {
  const hydrated = loadFromStorage()
  // Local helper so each setter doesn't have to enumerate every other
  // section when persisting. Single source of truth for the snapshot
  // shape — adding a new section in the future means one diff here.
  const snap = (
    s: ToolSettingsState,
    patch: Partial<PersistedShape>
  ): PersistedShape => ({
    defaults: patch.defaults ?? s.defaults,
    cursor: patch.cursor ?? s.cursor,
    sanitizer: patch.sanitizer ?? s.sanitizer,
    ephemeral: patch.ephemeral ?? s.ephemeral
  })
  return {
    defaults: hydrated.defaults,
    cursor: hydrated.cursor,
    sanitizer: hydrated.sanitizer,
    ephemeral: hydrated.ephemeral,
    setToolColor(tool, hex) {
      set((s) => {
        const updated = {
          ...s.defaults,
          [tool]: { ...s.defaults[tool], color: hex }
        }
        persist(snap(s, { defaults: updated }))
        return { defaults: updated }
      })
    },
    setToolStroke(tool, width) {
      set((s) => {
        const clamped = Math.max(1, Math.min(64, Math.round(width)))
        const updated = {
          ...s.defaults,
          [tool]: { ...s.defaults[tool], strokeWidth: clamped }
        }
        persist(snap(s, { defaults: updated }))
        return { defaults: updated }
      })
    },
    setToolOpacity(tool, opacity) {
      set((s) => {
        const clamped = Math.max(0, Math.min(1, opacity))
        const updated = {
          ...s.defaults,
          [tool]: { ...s.defaults[tool], opacity: clamped }
        }
        persist(snap(s, { defaults: updated }))
        return { defaults: updated }
      })
    },
    setCursor(patch) {
      set((s) => {
        const updated: CursorSettings = {
          ...s.cursor,
          ...patch,
          ...(typeof patch.intensity === 'number'
            ? { intensity: Math.max(0, Math.min(1, patch.intensity)) }
            : {}),
          ...(typeof patch.trailLengthMs === 'number'
            ? {
                trailLengthMs: Math.max(
                  120,
                  Math.min(3000, Math.round(patch.trailLengthMs))
                )
              }
            : {}),
          ...(typeof patch.size === 'number'
            ? { size: Math.max(0.5, Math.min(2.5, patch.size)) }
            : {})
        }
        persist(snap(s, { cursor: updated }))
        return { cursor: updated }
      })
    },
    setSanitizer(patch) {
      set((s) => {
        const updated: SanitizerSettings = { ...s.sanitizer, ...patch }
        persist(snap(s, { sanitizer: updated }))
        return { sanitizer: updated }
      })
    },
    setEphemeral(patch) {
      set((s) => {
        // 2 s minimum so the stroke is at least usable; 20 s ceiling so
        // a user-typed slider value can't pin the rAF prune loop.
        const updated: EphemeralSettings = {
          ...s.ephemeral,
          ...patch,
          ...(typeof patch.lifeMs === 'number'
            ? {
                lifeMs: Math.max(2000, Math.min(20000, Math.round(patch.lifeMs)))
              }
            : {})
        }
        persist(snap(s, { ephemeral: updated }))
        return { ephemeral: updated }
      })
    },
    resetAll() {
      const next: PersistedShape = emptyShape()
      persist(next)
      set(next)
    }
  }
})

// ----------------------------------------------------------------------------
// Cross-window sync
// ----------------------------------------------------------------------------
//
// The DOM `storage` event fires on every same-origin window *other than* the
// one that wrote the change. In Electron, all our BrowserWindows share the
// default session → same origin → same localStorage → event fires across
// renderers. So when the Tools page (Home window) calls setToolColor, the
// Toolbar window receives a `storage` event and re-hydrates its own zustand
// store instance.
//
// Guards: ignore unrelated keys, malformed JSON, and the special case where
// the value was cleared (newValue === null) — keep the current state then.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    if (event.newValue === null) return
    try {
      const next = parsePersisted(event.newValue)
      useToolSettingsStore.setState({
        defaults: next.defaults,
        cursor: next.cursor,
        sanitizer: next.sanitizer
      })
    } catch {
      // ignore malformed payload from another tab
    }
  })
}

export const FACTORY_TOOL_DEFAULTS = FACTORY_DEFAULTS
export const FACTORY_CURSOR_SETTINGS = FACTORY_CURSOR
