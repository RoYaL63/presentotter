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
    | 'rectangle'
    | 'circle'
    | 'arrow'
    | 'text'
    | 'spotlight'

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

    enableToolbar(): void
    disableToolbar(): void
    isToolbarEnabled(): Promise<boolean>
    onToolbarStatus(cb: (status: { enabled: boolean }) => void): () => void

    setTool(tool: ToolName): void
    setColor(hex: string): void
    setOpacity(value: number): void
    setStrokeWidth(width: number): void
    clearOverlay(): void
    undoOverlay(): void
    setOverlayInteractive(interactive: boolean): void
    setOverlayVisible(visible: boolean): void

    setLiveMasks(zones: LiveMask[]): void
    clearLiveMasks(): void
    onSetLiveMasks(cb: (zones: LiveMask[]) => void): () => void
    onClearLiveMasks(cb: () => void): () => void

    setCursorHighlight(enabled: boolean): void
    setCursorColor(hex: string): void
    setCursorSettings(settings: {
      color: string
      style: 'meteor' | 'classic' | 'minimal'
      trailLengthMs: number
      intensity: number
    }): void
    onCursorHighlight(cb: (enabled: boolean) => void): () => void
    onCursorColor(cb: (hex: string) => void): () => void
    onCursorSettings(
      cb: (settings: {
        color: string
        style: 'meteor' | 'classic' | 'minimal'
        trailLengthMs: number
        intensity: number
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

    toolbarMinimize(): void
    toolbarRestore(): void
    toolbarClose(): void
    openConsole(): void
  }

  interface Window {
    api?: PresentOtterAPI
  }
}

export {}
