import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      // 'json-summary' produit coverage/coverage-summary.json consommé par le CI.
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'release/',
        'integration-tests/',
        'src/main/',
        'src/renderer/main.tsx',
        'src/renderer/index.css',
        'eslint.config.js',
        'vite.config.ts',
        'vitest.config.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@interfaces': path.resolve(__dirname, './interfaces.ts'),
      '@event-bus': path.resolve(__dirname, './event-bus.ts')
    }
  }
})
