import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Vite is rooted at src/renderer so that index.html sits at the root of the
// dev server. Build output goes to dist/renderer (sibling of dist/main).
// `base: './'` produces relative asset URLs, required for Electron's file://
// protocol in production.
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@interfaces': path.resolve(__dirname, './interfaces.ts'),
      '@event-bus': path.resolve(__dirname, './event-bus.ts')
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      external: [
        // Node built-ins (used by Castor's frames-to-file, Archive's storage etc.)
        // These call paths run in the main process via IPC in Phase 4 — for P0
        // they're tree-shaken away because UI only touches mock adapters.
        /^node:.*/,
        'electron',
        'better-sqlite3',
        'fluent-ffmpeg',
        'uiohook-napi',
        'electron-store'
      ]
    }
  }
})
