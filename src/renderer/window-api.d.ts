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
    getRole(): Promise<'toolbar' | 'overlay' | 'console'>
    appVersion(): Promise<string>

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
