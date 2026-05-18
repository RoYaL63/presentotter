// Public exports for the UI agent (Vitrine).

export { App } from './App'
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

// Pages
export { Home } from './pages/Home'
export { Recording } from './pages/Recording'
export { Preview } from './pages/Preview'
export { Library } from './pages/Library'
export { Settings } from './pages/Settings'

// Components
export { RecordButton } from './components/RecordButton'
export { SourceSelector } from './components/SourceSelector'
export { AnnotationToolbar } from './components/AnnotationToolbar'
export { VideoPreview } from './components/VideoPreview'
export { TopBar } from './components/TopBar'
