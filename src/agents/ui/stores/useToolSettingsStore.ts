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
}

export interface ToolSettingsState {
  defaults: Record<ToolId, ToolDefaults>
  cursor: CursorSettings
  setToolColor(tool: ToolId, hex: string): void
  setToolStroke(tool: ToolId, width: number): void
  setToolOpacity(tool: ToolId, opacity: number): void
  setCursor(patch: Partial<CursorSettings>): void
  resetAll(): void
}

const STORAGE_KEY = 'presentotter:tool-settings:v1'

// Factory defaults built around the otter-morphism palette: coral for
// emphasis tools, deep-sea for structure shapes, cream for text accents,
// sunray for spotlight focus. Users can override any of these in Outils.
const FACTORY_DEFAULTS: Record<ToolId, ToolDefaults> = {
  pencil: { color: '#FF8B7B', strokeWidth: 4, opacity: 1 }, // coral pop
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
  intensity: 1
}

interface PersistedShape {
  defaults: Record<ToolId, ToolDefaults>
  cursor: CursorSettings
}

function loadFromStorage(): PersistedShape {
  if (typeof localStorage === 'undefined') {
    return { defaults: { ...FACTORY_DEFAULTS }, cursor: { ...FACTORY_CURSOR } }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return { defaults: { ...FACTORY_DEFAULTS }, cursor: { ...FACTORY_CURSOR } }
    }
    return parsePersisted(raw)
  } catch {
    return { defaults: { ...FACTORY_DEFAULTS }, cursor: { ...FACTORY_CURSOR } }
  }
}

function parsePersisted(raw: string): PersistedShape {
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object') {
    return { defaults: { ...FACTORY_DEFAULTS }, cursor: { ...FACTORY_CURSOR } }
  }
  const candidate = parsed as Partial<PersistedShape>
  return {
    defaults: { ...FACTORY_DEFAULTS, ...(candidate.defaults ?? {}) },
    cursor: { ...FACTORY_CURSOR, ...(candidate.cursor ?? {}) }
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
  return {
    defaults: hydrated.defaults,
    cursor: hydrated.cursor,
    setToolColor(tool, hex) {
      set((s) => {
        const updated = {
          ...s.defaults,
          [tool]: { ...s.defaults[tool], color: hex }
        }
        persist({ defaults: updated, cursor: s.cursor })
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
        persist({ defaults: updated, cursor: s.cursor })
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
        persist({ defaults: updated, cursor: s.cursor })
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
            : {})
        }
        persist({ defaults: s.defaults, cursor: updated })
        return { cursor: updated }
      })
    },
    resetAll() {
      const next: PersistedShape = {
        defaults: { ...FACTORY_DEFAULTS },
        cursor: { ...FACTORY_CURSOR }
      }
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
      useToolSettingsStore.setState({ defaults: next.defaults, cursor: next.cursor })
    } catch {
      // ignore malformed payload from another tab
    }
  })
}

export const FACTORY_TOOL_DEFAULTS = FACTORY_DEFAULTS
export const FACTORY_CURSOR_SETTINGS = FACTORY_CURSOR
