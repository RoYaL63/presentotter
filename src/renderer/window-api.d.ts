/**
 * Type augmentation for `window.api` exposed by src/main/preload.ts.
 *
 * The preload runs in a Node context and bundles separately (CommonJS),
 * so we duplicate its shape here for the renderer's type-only consumption.
 */

declare global {
  type ToolName =
    | 'select'
    | 'pencil'
    | 'ephemeral'
    | 'rectangle'
    | 'circle'
    | 'arrow'
    | 'text'
    | 'spotlight'
    | 'blur'

  interface LiveMask {
    x: number
    y: number
    width: number
    height: number
    label: string
  }

  interface PresentOtterAPI {
    getRole(): Promise<'home' | 'toolbar' | 'overlay' | 'console'>
    appVersion(): Promise<string>

    // ---------- Mirror page (embedded in Home) ----------
    mirrorListDisplays(): Promise<
      Array<{
        displayId: number
        sourceId: string
        label: string
        bounds: { x: number; y: number; width: number; height: number }
        scaleFactor: number
        isPrimary: boolean
      }>
    >

    enableToolbar(): void
    disableToolbar(): void
    isToolbarEnabled(): Promise<boolean>
    onToolbarStatus(cb: (status: { enabled: boolean }) => void): () => void
    toolbarSetHeight(height: number): void
    toolbarSetPosition(x: number, y: number): void
    toolbarSetBounds(b: { x: number; y: number; width: number; height: number }): void
    toolbarCurrentDisplayBounds(): Promise<{
      workArea: { x: number; y: number; width: number; height: number }
      scaleFactor: number
    } | null>

    setTool(tool: ToolName): void
    setColor(hex: string): void
    setOpacity(value: number): void
    setStrokeWidth(width: number): void
    setEphemeralLifeMs(ms: number): void
    onSetEphemeralLifeMs(cb: (ms: number) => void): () => void
    clearOverlay(): void
    undoOverlay(): void
    setOverlayInteractive(interactive: boolean): void
    setOverlayVisible(visible: boolean): void
    requestOverlayFocus(): void

    setLiveMasks(zones: LiveMask[]): void
    clearLiveMasks(): void
    onSetLiveMasks(cb: (zones: LiveMask[]) => void): () => void
    onClearLiveMasks(cb: () => void): () => void
    setLiveOcrWords(
      words: Array<{ x: number; y: number; width: number; height: number; text: string }>
    ): void
    clearLiveOcrWords(): void
    onSetLiveOcrWords(
      cb: (
        words: Array<{ x: number; y: number; width: number; height: number; text: string }>
      ) => void
    ): () => void
    onClearLiveOcrWords(cb: () => void): () => void
    onSetToolbarRect(
      cb: (rect: { x: number; y: number; width: number; height: number } | null) => void
    ): () => void
    liveCursorDisplayId(): Promise<number>
    liveAcquireTarget(): Promise<{
      sourceId: string
      displayId: number
      bounds: { x: number; y: number; width: number; height: number }
      scaleFactor: number
    } | null>
    startUia(): void
    stopUia(): void
    onUiaElements(
      cb: (
        els: Array<{ text: string; x: number; y: number; width: number; height: number }>
      ) => void
    ): () => void

    // ---------- Recording ----------
    recordingListSources(): Promise<
      Array<{
        id: string
        name: string
        kind: 'screen' | 'window'
        thumbnail: string | null
        appIcon: string | null
      }>
    >
    recordingSaveBlob(payload: {
      bytes: Uint8Array
      suggestedName: string
    }): Promise<{ path: string; dir: string }>
    recordingRevealInFolder(filePath: string): Promise<void>
    recordingChooseSavePath(defaultName: string): Promise<string | null>
    recordingExportMp4(
      webmPath: string
    ): Promise<{ ok: true; path: string } | { ok: false; reason: string }>

    setCursorHighlight(enabled: boolean): void
    setSpotlightActive(active: boolean): void
    onSpotlightActive(cb: (active: boolean) => void): () => void
    setCursorColor(hex: string): void
    setCursorSettings(settings: {
      color: string
      style: 'meteor' | 'classic' | 'minimal'
      trailLengthMs: number
      intensity: number
      size: number
    }): void
    onCursorHighlight(cb: (enabled: boolean) => void): () => void
    onCursorColor(cb: (hex: string) => void): () => void
    onCursorSettings(
      cb: (settings: {
        color: string
        style: 'meteor' | 'classic' | 'minimal'
        trailLengthMs: number
        intensity: number
        size: number
      }) => void
    ): () => void
    onCursorPosition(
      cb: (pos: {
        screenX: number
        screenY: number
        onDisplayId: number
        displayBounds: { x: number; y: number; width: number; height: number }
        timestamp: number
      }) => void
    ): () => void

    onSetTool(cb: (tool: ToolName) => void): () => void
    onSetColor(cb: (hex: string) => void): () => void
    onSetOpacity(cb: (value: number) => void): () => void
    onSetStrokeWidth(cb: (width: number) => void): () => void
    onClear(cb: () => void): () => void
    onUndo(cb: () => void): () => void
    onToolbarToolChanged(cb: (tool: ToolName) => void): () => void
    onCursorHighlightChanged(cb: (enabled: boolean) => void): () => void

    toolbarMinimize(): void
    toolbarRestore(): void
    toolbarClose(): void
    openConsole(): void
    openSanitizer(): void
    onOpenSanitizer(cb: () => void): () => void
    openShortcuts(): void
    onOpenShortcuts(cb: () => void): () => void
    checkForUpdate(): Promise<{
      currentVersion: string
      latestVersion: string
      upToDate: boolean
      downloadUrl: string | null
      downloadSizeMb: number | null
      htmlUrl: string | null
      publishedAt: string | null
    }>
    downloadAndLaunchUpdate(
      url: string
    ): Promise<{ path: string; launched: boolean; launchError?: string }>
    revealInstaller(filePath: string): Promise<void>
    onUpdateProgress(
      cb: (p: { downloaded: number; total: number }) => void
    ): () => void

    // ---------- Capture (Snipping-Tool replacement) ----------
    captureStart(mode: 'photo' | 'video'): void
    captureGetFrame(): Promise<{
      originX: number
      originY: number
      mode: 'photo' | 'video'
    } | null>
    captureRegionSelected(payload: {
      mode: 'photo' | 'video'
      screenRect: { x: number; y: number; width: number; height: number } | null
    }): void
    captureCancel(): void
    captureSelectionPreview(
      screenRect: { x: number; y: number; width: number; height: number } | null
    ): void
    onCaptureSelectionPreview(
      cb: (
        screenRect: { x: number; y: number; width: number; height: number } | null
      ) => void
    ): () => void

    // ---------- Region recorder (ShareX-style video) ----------
    recorderGetConfig(): Promise<{
      sourceId: string
      rect: { x: number; y: number; width: number; height: number }
      fps: number
    } | null>
    recorderDone(savePath: string | null): void
    onRecorderStop(cb: () => void): () => void

    // ---------- Capture editor ----------
    editorGetImage(): Promise<{
      dataUrl: string
      width: number
      height: number
    } | null>
    editorCopyImage(pngBase64: string): Promise<boolean>
    editorSaveImage(pngBase64: string): Promise<string | null>
    editorSaveImageAs(pngBase64: string): Promise<string | null>
    editorReveal(filePath: string): Promise<void>
    onEditorLoadImage(
      cb: (
        img: { dataUrl: string; width: number; height: number } | null
      ) => void
    ): () => void

    // ---------- Capture hotkeys (Settings) ----------
    getCaptureHotkeys(): Promise<{ capturePhoto: string; captureVideo: string }>
    defaultCaptureHotkeys(): Promise<{
      capturePhoto: string
      captureVideo: string
    }>
    setCaptureHotkeys(next: {
      capturePhoto?: string
      captureVideo?: string
    }): Promise<{
      hotkeys: { capturePhoto: string; captureVideo: string }
      capturePhotoOk: boolean
      captureVideoOk: boolean
    }>
    getOpenAtLogin(): Promise<boolean>
    setOpenAtLogin(enabled: boolean): Promise<boolean>
  }

  interface Window {
    api?: PresentOtterAPI
  }
}

export {}
