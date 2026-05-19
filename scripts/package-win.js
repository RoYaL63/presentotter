#!/usr/bin/env node
/**
 * Windows packaging script — optimised for fast first launch.
 *
 * Why a script rather than electron-builder:
 *   electron-builder always downloads winCodeSign during pack, even for the
 *   'dir' target. That archive contains macOS .dylib symlinks which fail to
 *   extract on Windows without Developer Mode (creating symlinks needs
 *   SeCreateSymbolicLinkPrivilege). We don't sign in v0.1.x-alpha so there's
 *   no reason to pull that dependency in.
 *
 * Why so many ignore patterns:
 *   The smaller the bundle, the less Windows Defender / SmartScreen has to
 *   scan on first launch — that scan is the dominant cause of the 'app
 *   takes a minute to open' user report. Removing dev-only deps trims
 *   roughly 200 MB and is the single biggest perf lever we have without
 *   signing the binary.
 *
 * Output: release/PresentOtter-win32-x64/PresentOtter.exe
 */

const { packager } = require('@electron/packager')
const path = require('node:path')
const fs = require('node:fs')

/**
 * Locales we keep in the Chromium runtime. Every other .pak under
 * release/<bundle>/locales/ is deleted post-pack — saves ~35 MB.
 */
const KEEP_LOCALES = new Set(['en-US.pak', 'fr.pak'])

/**
 * Paths matched against the leading slash of every project file. If any
 * regex matches, the file is excluded from the bundle.
 */
const IGNORE_PATTERNS = [
  // Build artefacts and workspace clutter
  /^\/release($|\/)/,
  /^\/coverage($|\/)/,
  /^\/integration-tests($|\/)/,
  /^\/scripts($|\/)/,
  /^\/\.github($|\/)/,
  /^\/\.claude($|\/)/,
  /^\/\.git($|\/)/,
  /^\/\.husky($|\/)/,
  /^\/build($|\/)/,
  /^\/src\/agents\/.*\/(__tests__|tests)\//,

  // Native deps the alpha doesn't ship (renderer uses mock adapters)
  /^\/node_modules\/better-sqlite3($|\/)/,
  /^\/node_modules\/uiohook-napi($|\/)/,
  /^\/node_modules\/fluent-ffmpeg($|\/)/,
  /^\/node_modules\/tesseract\.js-core($|\/)/,
  /^\/node_modules\/@types($|\/)/,

  // Dev / build-only deps that have no runtime role
  /^\/node_modules\/electron-builder($|\/)/,
  /^\/node_modules\/electron-builder-([a-z-]+)($|\/)/,
  /^\/node_modules\/@electron\/(builder|notarize|osx-sign|universal|rebuild|packager)($|\/)/,
  /^\/node_modules\/@electron-forge($|\/)/,
  /^\/node_modules\/vitest($|\/)/,
  /^\/node_modules\/@vitest($|\/)/,
  /^\/node_modules\/typescript-eslint($|\/)/,
  /^\/node_modules\/@typescript-eslint($|\/)/,
  /^\/node_modules\/eslint($|\/)/,
  /^\/node_modules\/@eslint($|\/)/,
  /^\/node_modules\/@eslint-community($|\/)/,
  /^\/node_modules\/eslint-([a-z-]+)($|\/)/,
  /^\/node_modules\/vite($|\/)/,
  /^\/node_modules\/@vitejs($|\/)/,
  /^\/node_modules\/typescript($|\/)/,
  /^\/node_modules\/tsc($|\/)/,
  /^\/node_modules\/tslib($|\/)/,
  /^\/node_modules\/concurrently($|\/)/,
  /^\/node_modules\/cross-env($|\/)/,
  /^\/node_modules\/wait-on($|\/)/,
  /^\/node_modules\/autoprefixer($|\/)/,
  /^\/node_modules\/tailwindcss($|\/)/,
  /^\/node_modules\/postcss($|\/)/,
  /^\/node_modules\/postcss-([a-z-]+)($|\/)/,
  /^\/node_modules\/rollup($|\/)/,
  /^\/node_modules\/@rollup($|\/)/,
  /^\/node_modules\/esbuild($|\/)/,
  /^\/node_modules\/@esbuild($|\/)/,
  /^\/node_modules\/@babel($|\/)/,
  /^\/node_modules\/electron-store($|\/)/,
  /^\/node_modules\/electron\/dist($|\/)/,

  // Source maps + markdown bloat
  /\.map$/,
  /\.md$/i,
  /\.markdown$/i,
  /\.d\.ts$/,
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
    // Trim Chromium locale .pak files down to French + English. Each .pak
    // is ~700 KB and there are 55 by default → saving ~35 MB.
    electronLocales: ['en-US', 'fr'],
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
    stripUnusedLocales(dir)
    reportBundleSize(dir)
    console.log(`[package-win] OK → ${dir}`)
  }
}

/**
 * @electron/packager's `electronLocales` option is unreliable across
 * versions — easier and deterministic to walk the output directory and
 * delete every locale we did not whitelist.
 */
function stripUnusedLocales(bundleDir) {
  const localesDir = path.join(bundleDir, 'locales')
  if (!fs.existsSync(localesDir)) return
  let removed = 0
  let savedBytes = 0
  for (const entry of fs.readdirSync(localesDir)) {
    if (KEEP_LOCALES.has(entry)) continue
    const full = path.join(localesDir, entry)
    const stat = fs.statSync(full)
    savedBytes += stat.size
    fs.unlinkSync(full)
    removed += 1
  }
  console.log(
    `[package-win] stripped ${removed} locale .pak file(s), saved ${(savedBytes / 1024 / 1024).toFixed(1)} MB`
  )
}

function reportBundleSize(bundleDir) {
  let totalBytes = 0
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else totalBytes += fs.statSync(full).size
    }
  }
  walk(bundleDir)
  console.log(
    `[package-win] bundle size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`
  )
}

main().catch((err) => {
  console.error('[package-win] Packaging failed:', err)
  process.exit(1)
})
