import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@interfaces': path.resolve(__dirname, './interfaces.ts'),
      '@event-bus': path.resolve(__dirname, './event-bus.ts')
    }
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true
  }
})
