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
  | 'blur'

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

  /** Which display the cursor is on right now (cheap, no getSources). */
  liveCursorDisplayId: (): Promise<number> =>
    ipcRenderer.invoke('live:cursor-display-id'),

  liveAcquireTarget: (): Promise<{
    sourceId: string
    displayId: number
    bounds: { x: number; y: number; width: number; height: number }
    scaleFactor: number
  } | null> => ipcRenderer.invoke('live:acquire-target'),

  /** UI-Automation sanitizer (fast path). Start/stop the native field
   *  scanner; masks (virtual-screen DIP) arrive via onUiaMasks. */
  startUia: () => ipcRenderer.send('live:uia-start'),
  stopUia: () => ipcRenderer.send('live:uia-stop'),
  onUiaElements: (
    cb: (
      els: Array<{ text: string; x: number; y: number; width: number; height: number }>
    ) => void
  ) => {
    const handler = (
      _e: unknown,
      els: Array<{ text: string; x: number; y: number; width: number; height: number }>
    ): void => cb(els)
    ipcRenderer.on('live:uia-elements', handler)
    return () => ipcRenderer.off('live:uia-elements', handler)
  },

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

  /** Overlay-side: the user clicked the ✕ on a mask. Main forwards this
   *  to the toolbar (the mask source) so it suppresses the region instead
   *  of re-masking it on the next scan. */
  dismissLiveMask: (region: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('sanitizer:dismiss-mask', region),
  /** Toolbar-side: a dismissal forwarded from an overlay. */
  onDismissLiveMask: (
    cb: (region: { x: number; y: number; width: number; height: number }) => void
  ) => {
    const handler = (
      _e: unknown,
      region: { x: number; y: number; width: number; height: number }
    ) => cb(region)
    ipcRenderer.on('sanitizer:dismiss-mask', handler)
    return () => ipcRenderer.off('sanitizer:dismiss-mask', handler)
  },

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

  /** Overlay-side: which display does this overlay window cover?
   *  Authoritative id + DIP bounds from main — window.screenX/Y is
   *  unreliable on mixed-DPI multi-monitor setups. */
  getOverlayDisplay: (): Promise<{
    id: number
    bounds: { x: number; y: number; width: number; height: number }
    scaleFactor: number
  } | null> => ipcRenderer.invoke('overlay:get-display'),

  /** Overlay-side: this overlay's display changed (resolution, scale,
   *  arrangement). Payload mirrors getOverlayDisplay. */
  onOverlayDisplayChanged: (
    cb: (info: {
      id: number
      bounds: { x: number; y: number; width: number; height: number }
      scaleFactor: number
    }) => void
  ) => {
    const handler = (
      _e: unknown,
      info: {
        id: number
        bounds: { x: number; y: number; width: number; height: number }
        scaleFactor: number
      }
    ) => cb(info)
    ipcRenderer.on('overlay:display-changed', handler)
    return () => ipcRenderer.off('overlay:display-changed', handler)
  },

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

  // ---------- Capture (Snipping-Tool replacement) ----------

  /** Home/toolbar trigger: start a capture session (photo or video). */
  captureStart: (mode: 'photo' | 'video') =>
    ipcRenderer.send('capture:start', mode),

  /** Capture window asks main for the virtual-desktop origin (the overlay
   *  spans all screens) + the requested mode. */
  captureGetFrame: (): Promise<{
    originX: number
    originY: number
    mode: 'photo' | 'video'
  } | null> => ipcRenderer.invoke('capture:get-frame'),

  /** Capture window: report the confirmed selection in screen-DIP coords
   *  (null = full screen). Main resolves the display + grabs/crops. */
  captureRegionSelected: (payload: {
    mode: 'photo' | 'video'
    screenRect: { x: number; y: number; width: number; height: number } | null
  }) => ipcRenderer.send('capture:region-selected', payload),

  /** Capture window: cancel the whole session (Esc). */
  captureCancel: () => ipcRenderer.send('capture:cancel'),

  /** Capture window: broadcast the in-progress selection (screen-DIP) so
   *  the OTHER screens' overlays can draw the same rectangle — keeps the
   *  border visible when a drag crosses monitors. null clears it. */
  captureSelectionPreview: (
    screenRect: { x: number; y: number; width: number; height: number } | null
  ) => ipcRenderer.send('capture:selection-preview', screenRect),
  onCaptureSelectionPreview: (
    cb: (
      screenRect: { x: number; y: number; width: number; height: number } | null
    ) => void
  ) => {
    const handler = (
      _e: unknown,
      r: { x: number; y: number; width: number; height: number } | null
    ): void => cb(r)
    ipcRenderer.on('capture:selection-preview-fwd', handler)
    return () => ipcRenderer.off('capture:selection-preview-fwd', handler)
  },

  // ---------- Region recorder (ShareX-style video) ----------

  /** Recorder window: fetch its capture config (source id + crop rect). */
  recorderGetConfig: (): Promise<{
    sourceId: string
    rect: { x: number; y: number; width: number; height: number }
    fps: number
  } | null> => ipcRenderer.invoke('recorder:get-config'),

  /** Recorder window: report it finished + saved (path or null). */
  recorderDone: (savePath: string | null) =>
    ipcRenderer.send('recorder:done', savePath),

  /** Recorder window: resize itself (compact pill ↔ full panel). */
  recorderSetSize: (width: number, height: number) =>
    ipcRenderer.send('recorder:set-size', { width, height }),

  /** Recorder window: move itself (manual header drag). */
  recorderSetPosition: (x: number, y: number) =>
    ipcRenderer.send('recorder:set-position', { x, y }),

  /** Recorder window: hop to the next display (so it never sits on the
   *  screen being filmed). */
  recorderCycleDisplay: () => ipcRenderer.send('recorder:cycle-display'),

  /** Recorder window: main asks it to stop (hotkey toggle). */
  onRecorderStop: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('recorder:stop', handler)
    return () => ipcRenderer.off('recorder:stop', handler)
  },

  // ---------- Capture editor ----------

  /** Editor: fetch the image to edit (base64 data URL + pixel size). */
  editorGetImage: (): Promise<{
    dataUrl: string
    width: number
    height: number
  } | null> => ipcRenderer.invoke('editor:get-image'),

  /** Editor: copy a (flattened) PNG to the clipboard. */
  editorCopyImage: (pngBase64: string): Promise<boolean> =>
    ipcRenderer.invoke('editor:copy-image', pngBase64),

  /** Editor: save a (flattened) PNG to the Captures folder. */
  editorSaveImage: (pngBase64: string): Promise<string | null> =>
    ipcRenderer.invoke('editor:save-image', pngBase64),

  /** Editor: save-as via a file dialog. */
  editorSaveImageAs: (pngBase64: string): Promise<string | null> =>
    ipcRenderer.invoke('editor:save-image-as', pngBase64),

  /** Editor: reveal a saved file in Explorer. */
  editorReveal: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('editor:reveal', filePath),

  /** Editor: main pushes a fresh image when the window is reused. */
  onEditorLoadImage: (
    cb: (img: { dataUrl: string; width: number; height: number } | null) => void
  ) => {
    const handler = (
      _e: unknown,
      img: { dataUrl: string; width: number; height: number } | null
    ) => cb(img)
    ipcRenderer.on('editor:load-image', handler)
    return () => ipcRenderer.off('editor:load-image', handler)
  },

  // ---------- Capture hotkeys (Settings) ----------

  getCaptureHotkeys: (): Promise<{
    capturePhoto: string
    captureVideo: string
  }> => ipcRenderer.invoke('settings:get-capture-hotkeys'),
  defaultCaptureHotkeys: (): Promise<{
    capturePhoto: string
    captureVideo: string
  }> => ipcRenderer.invoke('settings:default-capture-hotkeys'),
  setCaptureHotkeys: (next: {
    capturePhoto?: string
    captureVideo?: string
  }): Promise<{
    hotkeys: { capturePhoto: string; captureVideo: string }
    capturePhotoOk: boolean
    captureVideoOk: boolean
  }> => ipcRenderer.invoke('settings:set-capture-hotkeys', next),

  /** Run at Windows startup (in tray) so capture works any time. */
  getOpenAtLogin: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:get-open-at-login'),
  setOpenAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:set-open-at-login', enabled),

  // ---------- Misc ----------

  /** Hand main a PNG data URL of the app icon (rasterized from the webp
   *  mascot by the renderer, since main can't decode webp). */
  setAppIcon: (dataUrl: string) => ipcRenderer.send('app:set-icon', dataUrl),

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
  downloadAndLaunchUpdate: (
    url: string
  ): Promise<{ path: string; launched: boolean; launchError?: string }> =>
    ipcRenderer.invoke('updates:download-and-launch', url),
  /** Reveal the downloaded installer in Explorer (SAC fallback). */
  revealInstaller: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('updates:reveal-installer', filePath),
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
