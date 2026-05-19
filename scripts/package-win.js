#!/usr/bin/env node
/**
 * Windows packaging script.
 *
 * Uses @electron/packager directly so we sidestep electron-builder's
 * winCodeSign download, which fails to unpack on Windows without
 * Developer Mode (symbolic-link privilege required for macOS .dylib
 * symlinks inside the toolkit archive). We don't need code signing for
 * v0.1.x-alpha, so this avoids the whole class of problems.
 *
 * Produces: release/PresentOtter-win32-x64/PresentOtter.exe
 */

const { packager } = require('@electron/packager')
const path = require('node:path')

/**
 * Files / folders we don't want shipped in the bundle. Patterns are
 * matched as substrings against the path inside the project root.
 */
const IGNORE_PATTERNS = [
  /^\/release($|\/)/,
  /^\/coverage($|\/)/,
  /^\/integration-tests($|\/)/,
  /^\/scripts($|\/)/,
  /^\/\.github($|\/)/,
  /^\/\.claude($|\/)/,
  /^\/\.git($|\/)/,
  /^\/src\/agents\/.*\/(__tests__|tests)\//,
  // Native deps we don't ship in the alpha (renderer uses mock adapters)
  /^\/node_modules\/better-sqlite3($|\/)/,
  /^\/node_modules\/uiohook-napi($|\/)/,
  /^\/node_modules\/fluent-ffmpeg($|\/)/,
  /^\/node_modules\/tesseract\.js-core($|\/)/,
  // Heavy dev-only deps we don't need at runtime
  /^\/node_modules\/electron-builder($|\/)/,
  /^\/node_modules\/vitest($|\/)/,
  /^\/node_modules\/typescript-eslint($|\/)/,
  /^\/node_modules\/eslint($|\/)/,
  /^\/node_modules\/@vitest($|\/)/,
  /^\/node_modules\/@typescript-eslint($|\/)/,
  /^\/node_modules\/@electron\/rebuild($|\/)/,
  /\.map$/,
  /\.md$/i,
  /\.lock$/
]

async function main() {
  const projectRoot = path.resolve(__dirname, '..')
  console.log(`[package-win] Packaging from ${projectRoot}`)

  const out = await packager({
    dir: projectRoot,
    name: 'PresentOtter',
    platform: 'win32',
    arch: 'x64',
    out: path.join(projectRoot, 'release'),
    overwrite: true,
    asar: true,
    appVersion: '0.1.0',
    appCopyright: 'Copyright © 2025 OTTERWISE Solutions',
    win32metadata: {
      CompanyName: 'OTTERWISE Solutions',
      FileDescription: 'PresentOtter — open-source screen annotation toolbar',
      OriginalFilename: 'PresentOtter.exe',
      ProductName: 'PresentOtter',
      InternalName: 'PresentOtter'
    },
    ignore: (p) => IGNORE_PATTERNS.some((re) => re.test(p))
  })

  for (const dir of out) {
    console.log(`[package-win] OK → ${dir}`)
  }
}

main().catch((err) => {
  console.error('[package-win] Packaging failed:', err)
  process.exit(1)
})
