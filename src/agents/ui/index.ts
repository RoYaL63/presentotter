// Public exports for the UI agent (Vitrine).
//
// As of v0.1.x-alpha, the multi-window console has been folded into the
// single Home component. Recording / Preview pages and their helper
// components have been removed; the floating Toolbar + Overlay are the
// only siblings of Home.

export { Home } from './Home'
export { Toolbar } from './Toolbar'
export { Overlay } from './Overlay'
export { SanitizerPopup } from './SanitizerPopup'
export { registerUIEventListeners } from './eventListeners'

// Stores
export { useRecordingStore, type RecordingState } from './stores/useRecordingStore'
export {
  useAnnotationStore,
  type AnnotationState,
  type AnnotationMode
} from './stores/useAnnotationStore'
export { useLibraryStore, type LibraryState } from './stores/useLibraryStore'
export { useNavStore, type NavState, type PageName } from './stores/useNavStore'
export { useExportStore } from './stores/useExportStore'
export {
  useToolSettingsStore,
  type ToolDefaults,
  type CursorSettings,
  type CursorStyle,
  type ToolId
} from './stores/useToolSettingsStore'

// Integration
export { UIOrchestrator, orchestrator, getOrchestrator } from './orchestrator'

// Sections (rendered inside Home)
export { Library } from './pages/Library'
export { Settings } from './pages/Settings'
export { Tools } from './pages/Tools'
