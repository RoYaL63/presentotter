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
  | 'ephemeral'
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

  /** Grow / shrink the toolbar window vertically — used by the inline
   *  color popover so it has room to render under the capsule. */
  toolbarSetHeight: (height: number) =>
    ipcRenderer.send('toolbar:set-height', height),

  /** Reposition the toolbar window — used by the minimized bubble's
   *  drag handler so the user can park the mascot anywhere on screen. */
  toolbarSetPosition: (x: number, y: number) =>
    ipcRenderer.send('toolbar:set-position', { x, y }),

  /** Atomic resize+reposition. Used by the vertical-dock toggle so the
   *  orientation change applies without a flash of the wrong shape. */
  toolbarSetBounds: (b: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('toolbar:set-bounds', b),

  /** Get the workArea of the display the toolbar currently sits on so
   *  the renderer can snap to the right/left edge of THAT screen. */
  toolbarCurrentDisplayBounds: (): Promise<{
    workArea: { x: number; y: number; width: number; height: number }
    scaleFactor: number
  } | null> => ipcRenderer.invoke('toolbar:current-display-bounds'),

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
  /** Push the user's ephemeral-stroke lifetime (ms) to every overlay
   *  so the next stroke they draw uses the latest value. Strokes
   *  already on screen keep their per-stroke lifeMs (captured at
   *  pointer-down) and finish their existing fade. */
  setEphemeralLifeMs: (ms: number) =>
    ipcRenderer.send('overlay:set-ephemeral-life', ms),
  onSetEphemeralLifeMs: (cb: (ms: number) => void) => {
    const handler = (_e: unknown, ms: number) => cb(ms)
    ipcRenderer.on('overlay:set-ephemeral-life', handler)
    return () => ipcRenderer.off('overlay:set-ephemeral-life', handler)
  },
  clearOverlay: () => ipcRenderer.send('overlay:clear'),
  undoOverlay: () => ipcRenderer.send('overlay:undo'),

  // ---------- Live sanitizer ----------

  /** Ask main which display to capture and how to translate its pixels
   *  into the virtual-screen CSS coordinates used by the overlays. */
  // ---------- Mirror page (embedded in Home) ----------

  /** List every display PresentOtter can capture for the mirror, with
   *  the desktopCapturer sourceId plus CSS bounds + DPI. */
  mirrorListDisplays: (): Promise<
    Array<{
      displayId: number
      sourceId: string
      label: string
      bounds: { x: number; y: number; width: number; height: number }
      scaleFactor: number
      isPrimary: boolean
    }>
  > => ipcRenderer.invoke('mirror:list-displays'),

  liveAcquireTarget: (): Promise<{
    sourceId: string
    displayId: number
    bounds: { x: number; y: number; width: number; height: number }
    scaleFactor: number
  } | null> => ipcRenderer.invoke('live:acquire-target'),

  // ---------- Recording ----------

  recordingListSources: (): Promise<
    Array<{
      id: string
      name: string
      kind: 'screen' | 'window'
      thumbnail: string | null
      appIcon: string | null
    }>
  > => ipcRenderer.invoke('recording:list-sources'),
  recordingSaveBlob: (payload: {
    bytes: Uint8Array
    suggestedName: string
  }): Promise<{ path: string; dir: string }> =>
    ipcRenderer.invoke('recording:save-blob', payload),
  recordingRevealInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('recording:reveal-in-folder', filePath),
  recordingChooseSavePath: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('recording:choose-save-path', defaultName),
  recordingExportMp4: (
    webmPath: string
  ): Promise<{ ok: true; path: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('recording:export-mp4', webmPath),

  /** Push a fresh set of live-mask rectangles to the overlay. */
  setLiveMasks: (zones: Array<{ x: number; y: number; width: number; height: number; label: string }>) =>
    ipcRenderer.send('overlay:set-live-masks', zones),
  clearLiveMasks: () => ipcRenderer.send('overlay:clear-live-masks'),

  /** Diagnostic feed: the OCR word boxes from the last scan. The
   *  overlay only renders these if its local debugOcr flag is on. */
  setLiveOcrWords: (
    words: Array<{ x: number; y: number; width: number; height: number; text: string }>
  ) => ipcRenderer.send('overlay:set-live-ocr-words', words),
  clearLiveOcrWords: () => ipcRenderer.send('overlay:clear-live-ocr-words'),

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
  onSetLiveOcrWords: (
    cb: (
      words: Array<{ x: number; y: number; width: number; height: number; text: string }>
    ) => void
  ) => {
    const handler = (
      _e: unknown,
      words: Array<{ x: number; y: number; width: number; height: number; text: string }>
    ) => cb(words)
    ipcRenderer.on('overlay:set-live-ocr-words', handler)
    return () => ipcRenderer.off('overlay:set-live-ocr-words', handler)
  },
  onClearLiveOcrWords: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('overlay:clear-live-ocr-words', handler)
    return () => ipcRenderer.off('overlay:clear-live-ocr-words', handler)
  },

  /** Overlay-side: receive the toolbar's current screen rectangle so
   *  pointer-down events that land inside it can be skipped, keeping
   *  strokes from being drawn underneath the toolbar window. */
  onSetToolbarRect: (
    cb: (rect: { x: number; y: number; width: number; height: number } | null) => void
  ) => {
    const handler = (
      _e: unknown,
      rect: { x: number; y: number; width: number; height: number } | null
    ) => cb(rect)
    ipcRenderer.on('overlay:set-toolbar-rect', handler)
    return () => ipcRenderer.off('overlay:set-toolbar-rect', handler)
  },

  /** Toggle whether the overlay catches pointer events (false = click-through). */
  setOverlayInteractive: (interactive: boolean) =>
    ipcRenderer.send('overlay:set-interactive', interactive),

  /** Overlay-side: ask main to focus this specific overlay window so a
   *  text input can receive keystrokes. */
  requestOverlayFocus: () => ipcRenderer.send('overlay:request-focus'),

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

  /** Toolbar-side: cursor highlight toggled from a global gesture
   *  (triple-tap Alt) so the toolbar's "active" indicator stays in sync. */
  onCursorHighlightChanged: (cb: (enabled: boolean) => void) => {
    const handler = (_e: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on('toolbar:cursor-highlight-changed', handler)
    return () => ipcRenderer.off('toolbar:cursor-highlight-changed', handler)
  },

  // ---------- Cursor highlight ----------

  setCursorHighlight: (enabled: boolean) => ipcRenderer.send('cursor:set-highlight', enabled),
  /** Spotlight tool — when active, overlay paints a dark wash with a
   *  clear circle around the live cursor position. Same cursor poll as
   *  the highlight, separate visual. */
  setSpotlightActive: (active: boolean) => ipcRenderer.send('spotlight:set-active', active),
  onSpotlightActive: (cb: (active: boolean) => void) => {
    const handler = (_e: unknown, active: boolean) => cb(active)
    ipcRenderer.on('spotlight:set-active', handler)
    return () => ipcRenderer.off('spotlight:set-active', handler)
  },
  setCursorColor: (hex: string) => ipcRenderer.send('cursor:set-color', hex),
  setCursorSettings: (settings: {
    color: string
    style: 'meteor' | 'classic' | 'minimal'
    trailLengthMs: number
    intensity: number
    size: number
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
      size: number
    }) => void
  ) => {
    const handler = (
      _e: unknown,
      settings: {
        color: string
        style: 'meteor' | 'classic' | 'minimal'
        trailLengthMs: number
        intensity: number
        size: number
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
  /** Toolbar shortcut: focus Home + ask it to open the manual
   *  sanitizer popup (which needs more vertical room than the toolbar
   *  window has). */
  openSanitizer: () => ipcRenderer.send('console:open-sanitizer'),
  onOpenSanitizer: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('home:open-sanitizer', handler)
    return () => ipcRenderer.off('home:open-sanitizer', handler)
  },
  openShortcuts: () => ipcRenderer.send('console:open-shortcuts'),
  onOpenShortcuts: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('home:open-shortcuts', handler)
    return () => ipcRenderer.off('home:open-shortcuts', handler)
  },

  // ---------- Misc ----------

  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  // ---------- Self-update ----------
  checkForUpdate: (): Promise<{
    currentVersion: string
    latestVersion: string
    upToDate: boolean
    downloadUrl: string | null
    downloadSizeMb: number | null
    htmlUrl: string | null
    publishedAt: string | null
  }> => ipcRenderer.invoke('updates:check'),
  downloadAndLaunchUpdate: (url: string): Promise<string> =>
    ipcRenderer.invoke('updates:download-and-launch', url),
  onUpdateProgress: (
    cb: (p: { downloaded: number; total: number }) => void
  ) => {
    const handler = (
      _e: unknown,
      p: { downloaded: number; total: number }
    ) => cb(p)
    ipcRenderer.on('updates:download-progress', handler)
    return () => ipcRenderer.off('updates:download-progress', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type PresentOtterAPI = typeof api
