/**
 * Electron preload script.
 *
 * Runs in an isolated context bridging Node.js (main) and the renderer (browser).
 * Currently intentionally minimal: no IPC surface is exposed in P0.
 *
 * Phase 4 will extend this file using `contextBridge.exposeInMainWorld('api', { ... })`
 * to expose native capabilities (file dialogs, native menus, OS notifications,
 * permission probes, etc.) to the renderer in a safe, typed way.
 *
 * Keep `contextIsolation: true` and `nodeIntegration: false` in BrowserWindow
 * webPreferences — this preload is the only legitimate bridge.
 */

// Touch the contextBridge import path now so the bundle exists and Electron
// does not warn about a missing preload file. No globals are mutated yet.
import { contextBridge } from 'electron'

// Reserved namespace for future bridge surface. Currently a no-op marker so the
// renderer can feature-detect ("window.api ? ...") without crashing.
contextBridge.exposeInMainWorld('api', {
  // Phase 4: showOpenDialog, showSaveDialog, getAppVersion, etc.
  __ready: true
})
