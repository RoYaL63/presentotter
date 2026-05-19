import { contextBridge, ipcRenderer } from 'electron'

/**
 * Public IPC surface exposed to the renderer windows.
 *
 * Two window roles share this preload:
 * - 'toolbar' — sends commands (setTool, setColor, clear, toggleRec, etc.)
 * - 'overlay' — listens for those commands and forwards pointer activity
 *
 * Renderer code MUST go through `window.api` — never `require('electron')`.
 */

export type ToolName =
  | 'select'
  | 'pencil'
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'text'
  | 'spotlight'

const api = {
  /** Identify which window this renderer belongs to. */
  getRole: (): Promise<'home' | 'toolbar' | 'overlay' | 'console'> =>
    ipcRenderer.invoke('window:get-role'),

  // ---------- Home → toolbar lifecycle ----------

  enableToolbar: () => ipcRenderer.send('toolbar:enable'),
  disableToolbar: () => ipcRenderer.send('toolbar:disable'),
  isToolbarEnabled: (): Promise<boolean> => ipcRenderer.invoke('toolbar:is-enabled'),

  onToolbarStatus: (cb: (status: { enabled: boolean }) => void) => {
    const handler = (_e: unknown, status: { enabled: boolean }) => cb(status)
    ipcRenderer.on('home:toolbar-status', handler)
    return () => ipcRenderer.off('home:toolbar-status', handler)
  },

  // ---------- Toolbar → Main → Overlay ----------

  setTool: (tool: ToolName) => ipcRenderer.send('overlay:set-tool', tool),
  setColor: (hex: string) => ipcRenderer.send('overlay:set-color', hex),
  setOpacity: (value: number) => ipcRenderer.send('overlay:set-opacity', value),
  setStrokeWidth: (width: number) => ipcRenderer.send('overlay:set-stroke', width),
  clearOverlay: () => ipcRenderer.send('overlay:clear'),
  undoOverlay: () => ipcRenderer.send('overlay:undo'),

  // ---------- Live sanitizer ----------

  /** Push a fresh set of live-mask rectangles to the overlay. */
  setLiveMasks: (zones: Array<{ x: number; y: number; width: number; height: number; label: string }>) =>
    ipcRenderer.send('overlay:set-live-masks', zones),
  clearLiveMasks: () => ipcRenderer.send('overlay:clear-live-masks'),

  onSetLiveMasks: (
    cb: (zones: Array<{ x: number; y: number; width: number; height: number; label: string }>) => void
  ) => {
    const handler = (
      _e: unknown,
      zones: Array<{ x: number; y: number; width: number; height: number; label: string }>
    ) => cb(zones)
    ipcRenderer.on('overlay:set-live-masks', handler)
    return () => ipcRenderer.off('overlay:set-live-masks', handler)
  },
  onClearLiveMasks: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('overlay:clear-live-masks', handler)
    return () => ipcRenderer.off('overlay:clear-live-masks', handler)
  },

  /** Toggle whether the overlay catches pointer events (false = click-through). */
  setOverlayInteractive: (interactive: boolean) =>
    ipcRenderer.send('overlay:set-interactive', interactive),

  /** Toggle overlay visibility entirely. */
  setOverlayVisible: (visible: boolean) =>
    ipcRenderer.send('overlay:set-visible', visible),

  // ---------- Overlay-side listeners ----------

  onSetTool: (cb: (tool: ToolName) => void) => {
    const handler = (_e: unknown, tool: ToolName) => cb(tool)
    ipcRenderer.on('overlay:set-tool', handler)
    return () => ipcRenderer.off('overlay:set-tool', handler)
  },
  onSetColor: (cb: (hex: string) => void) => {
    const handler = (_e: unknown, hex: string) => cb(hex)
    ipcRenderer.on('overlay:set-color', handler)
    return () => ipcRenderer.off('overlay:set-color', handler)
  },
  onSetOpacity: (cb: (value: number) => void) => {
    const handler = (_e: unknown, v: number) => cb(v)
    ipcRenderer.on('overlay:set-opacity', handler)
    return () => ipcRenderer.off('overlay:set-opacity', handler)
  },
  onSetStrokeWidth: (cb: (width: number) => void) => {
    const handler = (_e: unknown, w: number) => cb(w)
    ipcRenderer.on('overlay:set-stroke', handler)
    return () => ipcRenderer.off('overlay:set-stroke', handler)
  },
  onClear: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('overlay:clear', handler)
    return () => ipcRenderer.off('overlay:clear', handler)
  },
  onUndo: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('overlay:undo', handler)
    return () => ipcRenderer.off('overlay:undo', handler)
  },

  /** Toolbar-side: tool change emitted by a global shortcut (Alt+P etc). */
  onToolbarToolChanged: (cb: (tool: ToolName) => void) => {
    const handler = (_e: unknown, tool: ToolName) => cb(tool)
    ipcRenderer.on('toolbar:tool-changed', handler)
    return () => ipcRenderer.off('toolbar:tool-changed', handler)
  },

  // ---------- Cursor highlight ----------

  setCursorHighlight: (enabled: boolean) => ipcRenderer.send('cursor:set-highlight', enabled),
  setCursorColor: (hex: string) => ipcRenderer.send('cursor:set-color', hex),
  setCursorSettings: (settings: {
    color: string
    style: 'meteor' | 'classic' | 'minimal'
    trailLengthMs: number
    intensity: number
  }) => ipcRenderer.send('cursor:set-settings', settings),

  onCursorHighlight: (cb: (enabled: boolean) => void) => {
    const handler = (_e: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on('cursor:set-highlight', handler)
    return () => ipcRenderer.off('cursor:set-highlight', handler)
  },

  onCursorColor: (cb: (hex: string) => void) => {
    const handler = (_e: unknown, hex: string) => cb(hex)
    ipcRenderer.on('cursor:set-color', handler)
    return () => ipcRenderer.off('cursor:set-color', handler)
  },

  onCursorSettings: (
    cb: (settings: {
      color: string
      style: 'meteor' | 'classic' | 'minimal'
      trailLengthMs: number
      intensity: number
    }) => void
  ) => {
    const handler = (
      _e: unknown,
      settings: {
        color: string
        style: 'meteor' | 'classic' | 'minimal'
        trailLengthMs: number
        intensity: number
      }
    ) => cb(settings)
    ipcRenderer.on('cursor:set-settings', handler)
    return () => ipcRenderer.off('cursor:set-settings', handler)
  },

  onCursorPosition: (
    cb: (pos: {
      screenX: number
      screenY: number
      onDisplayId: number
      displayBounds: { x: number; y: number; width: number; height: number }
      timestamp: number
    }) => void
  ) => {
    const handler = (
      _e: unknown,
      pos: {
        screenX: number
        screenY: number
        onDisplayId: number
        displayBounds: { x: number; y: number; width: number; height: number }
        timestamp: number
      }
    ) => cb(pos)
    ipcRenderer.on('cursor:position', handler)
    return () => ipcRenderer.off('cursor:position', handler)
  },

  // ---------- Window controls ----------

  toolbarMinimize: () => ipcRenderer.send('toolbar:minimize'),
  toolbarRestore: () => ipcRenderer.send('toolbar:restore'),
  toolbarClose: () => ipcRenderer.send('toolbar:close'),
  openConsole: () => ipcRenderer.send('console:open'),

  // ---------- Misc ----------

  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
}

contextBridge.exposeInMainWorld('api', api)

export type PresentOtterAPI = typeof api
