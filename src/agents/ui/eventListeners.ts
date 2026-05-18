import type { Subscription } from 'rxjs'
import { eventBus } from '@event-bus'
import { useRecordingStore } from './stores/useRecordingStore'
import { useLibraryStore } from './stores/useLibraryStore'
import { useExportStore } from './stores/useExportStore'

/**
 * Wire up the UI stores to the event bus so they reflect events emitted by
 * sibling agents (Plongeon/capture, Gardien/sanitizer, Castor/export, Library).
 * Returns a teardown function that unsubscribes everything.
 */
export function registerUIEventListeners(): () => void {
  const subscriptions: Subscription[] = []

  subscriptions.push(
    eventBus.on('capture:started').subscribe(({ sessionId, config }) => {
      useRecordingStore.getState().startRecording(config, sessionId)
    })
  )

  subscriptions.push(
    eventBus.on('capture:paused').subscribe(({ elapsed }) => {
      const store = useRecordingStore.getState()
      store.pauseRecording()
      store.tick(elapsed)
    })
  )

  subscriptions.push(
    eventBus.on('capture:resumed').subscribe(() => {
      useRecordingStore.getState().resumeRecording()
    })
  )

  subscriptions.push(
    eventBus.on('capture:stopped').subscribe(() => {
      useRecordingStore.getState().stopRecording()
    })
  )

  subscriptions.push(
    eventBus.on('library:recording-deleted').subscribe(({ id }) => {
      useLibraryStore.getState().removeRecording(id)
    })
  )

  subscriptions.push(
    eventBus.on('library:recording-renamed').subscribe(({ id, newName }) => {
      useLibraryStore.getState().renameRecording(id, newName)
    })
  )

  subscriptions.push(
    eventBus.on('library:recording-tagged').subscribe(({ id, tags }) => {
      useLibraryStore.getState().setTags(id, tags)
    })
  )

  subscriptions.push(
    eventBus.on('export:started').subscribe(() => {
      useExportStore.getState().setStarted()
    })
  )

  subscriptions.push(
    eventBus.on('export:progress').subscribe(({ percent, currentFrame, eta }) => {
      useExportStore.getState().setProgress(percent, currentFrame, eta)
    })
  )

  subscriptions.push(
    eventBus.on('export:complete').subscribe(({ outputPath }) => {
      useExportStore.getState().setComplete(outputPath)
    })
  )

  subscriptions.push(
    eventBus.on('export:error').subscribe(({ message }) => {
      useExportStore.getState().setError(message)
    })
  )

  return () => {
    for (const sub of subscriptions) sub.unsubscribe()
  }
}
