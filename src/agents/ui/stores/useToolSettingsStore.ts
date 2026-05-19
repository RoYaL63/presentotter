import { create } from 'zustand'

/**
 * Persistent per-tool defaults + cursor highlight preferences.
 *
 * Stored in localStorage under `presentotter:tool-settings:v1`. The
 * Tools page edits these values; the floating Toolbar reads them when
 * the user switches tools so the user's preferred color / thickness /
 * opacity travels across sessions.
 *
 * We avoid the zustand `persist` middleware (extra dependency surface)
 * and just hydrate manually — gives full control over the v1 schema.
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

const FACTORY_DEFAULTS: Record<ToolId, ToolDefaults> = {
  pencil: { color: '#ef4444', strokeWidth: 4, opacity: 1 },
  rectangle: { color: '#22d3ee', strokeWidth: 3, opacity: 1 },
  circle: { color: '#a855f7', strokeWidth: 3, opacity: 1 },
  arrow: { color: '#f97316', strokeWidth: 5, opacity: 1 },
  text: { color: '#ffffff', strokeWidth: 6, opacity: 1 },
  spotlight: { color: '#eab308', strokeWidth: 4, opacity: 0.6 }
}

const FACTORY_CURSOR: CursorSettings = {
  color: '#22d3ee',
  style: 'meteor',
  trailLengthMs: 900,
  intensity: 1
}

function loadFromStorage(): { defaults: Record<ToolId, ToolDefaults>; cursor: CursorSettings } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return { defaults: { ...FACTORY_DEFAULTS }, cursor: { ...FACTORY_CURSOR } }
    }
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') {
      return { defaults: { ...FACTORY_DEFAULTS }, cursor: { ...FACTORY_CURSOR } }
    }
    const candidate = parsed as Partial<ToolSettingsState>
    return {
      defaults: { ...FACTORY_DEFAULTS, ...(candidate.defaults ?? {}) },
      cursor: { ...FACTORY_CURSOR, ...(candidate.cursor ?? {}) }
    }
  } catch {
    return { defaults: { ...FACTORY_DEFAULTS }, cursor: { ...FACTORY_CURSOR } }
  }
}

function persist(state: { defaults: Record<ToolId, ToolDefaults>; cursor: CursorSettings }): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ defaults: state.defaults, cursor: state.cursor })
    )
  } catch {
    // localStorage full / blocked — silent
  }
}

export const useToolSettingsStore = create<ToolSettingsState>((set, get) => {
  const hydrated = loadFromStorage()
  return {
    defaults: hydrated.defaults,
    cursor: hydrated.cursor,
    setToolColor(tool, hex) {
      set((s) => {
        const current = s.defaults[tool]
        const updated = { ...s.defaults, [tool]: { ...current, color: hex } }
        persist({ defaults: updated, cursor: s.cursor })
        return { defaults: updated }
      })
    },
    setToolStroke(tool, width) {
      set((s) => {
        const current = s.defaults[tool]
        const clamped = Math.max(1, Math.min(64, Math.round(width)))
        const updated = {
          ...s.defaults,
          [tool]: { ...current, strokeWidth: clamped }
        }
        persist({ defaults: updated, cursor: s.cursor })
        return { defaults: updated }
      })
    },
    setToolOpacity(tool, opacity) {
      set((s) => {
        const current = s.defaults[tool]
        const clamped = Math.max(0, Math.min(1, opacity))
        const updated = {
          ...s.defaults,
          [tool]: { ...current, opacity: clamped }
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
            ? { trailLengthMs: Math.max(120, Math.min(3000, Math.round(patch.trailLengthMs))) }
            : {})
        }
        persist({ defaults: s.defaults, cursor: updated })
        return { cursor: updated }
      })
    },
    resetAll() {
      const next = {
        defaults: { ...FACTORY_DEFAULTS },
        cursor: { ...FACTORY_CURSOR }
      }
      persist(next)
      set(next)
      void get
    }
  }
})

export const FACTORY_TOOL_DEFAULTS = FACTORY_DEFAULTS
export const FACTORY_CURSOR_SETTINGS = FACTORY_CURSOR
