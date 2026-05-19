import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // .claude/worktrees/ holds throwaway git worktrees spawned by background
    // sub-agents during this Claude Code session — they would otherwise be
    // picked up as duplicate test files (often outdated copies that fail).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/.claude/**',
      '**/.{idea,git,cache,output,temp}/**'
    ],
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
