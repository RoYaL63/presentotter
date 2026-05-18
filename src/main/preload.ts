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
  getRole: (): Promise<'toolbar' | 'overlay' | 'console'> =>
    ipcRenderer.invoke('window:get-role'),

  // ---------- Toolbar → Main → Overlay ----------

  setTool: (tool: ToolName) => ipcRenderer.send('overlay:set-tool', tool),
  setColor: (hex: string) => ipcRenderer.send('overlay:set-color', hex),
  setOpacity: (value: number) => ipcRenderer.send('overlay:set-opacity', value),
  setStrokeWidth: (width: number) => ipcRenderer.send('overlay:set-stroke', width),
  clearOverlay: () => ipcRenderer.send('overlay:clear'),
  undoOverlay: () => ipcRenderer.send('overlay:undo'),

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
