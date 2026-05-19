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
const { spawnSync, execSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

/**
 * Locales we keep in the Chromium runtime. Every other .pak under
 * release/<bundle>/locales/ is deleted post-pack — saves ~35 MB.
 */
const KEEP_LOCALES = new Set(['en-US.pak', 'fr.pak'])

/** RFC 3161 timestamp servers we'll try in order if signing is requested. */
const TIMESTAMP_SERVERS = [
  'http://timestamp.digicert.com',
  'http://timestamp.sectigo.com',
  'http://timestamp.globalsign.com/tsa/r6advanced1'
]

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
    signExeIfRequested(dir)
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

/**
 * Sign PresentOtter.exe with signtool — only if the user has provided
 * credentials via environment variables. No env vars set → no-op (the
 * alpha ships unsigned and tells users to click 'Run anyway').
 *
 * Two modes supported:
 *   A) PFX file on disk:
 *        CSC_LINK=C:/path/to/cert.pfx
 *        CSC_KEY_PASSWORD=<pfx password>
 *   B) Certificate already imported into the Windows Cert Store
 *      (typical for EV certs delivered on a USB token / HSM):
 *        WIN_SIGN_CERT_SUBJECT="OTTERWISE Solutions"
 *
 * Optional:
 *   WIN_SIGN_TIMESTAMP_URL=<override default timestamp server>
 */
function signExeIfRequested(bundleDir) {
  const exePath = path.join(bundleDir, 'PresentOtter.exe')
  if (!fs.existsSync(exePath)) {
    console.warn(`[package-win] no PresentOtter.exe at ${exePath}, skipping signing`)
    return
  }

  const pfx = process.env.CSC_LINK
  const pfxPassword = process.env.CSC_KEY_PASSWORD
  const certSubject = process.env.WIN_SIGN_CERT_SUBJECT
  const timestamp = process.env.WIN_SIGN_TIMESTAMP_URL ?? TIMESTAMP_SERVERS[0]

  const hasPfx = typeof pfx === 'string' && pfx.length > 0
  const hasSubject = typeof certSubject === 'string' && certSubject.length > 0
  if (!hasPfx && !hasSubject) {
    console.log(
      '[package-win] signing skipped (set CSC_LINK + CSC_KEY_PASSWORD for PFX, or WIN_SIGN_CERT_SUBJECT for cert store)'
    )
    return
  }

  const signtool = locateSigntool()
  if (signtool === null) {
    console.warn(
      '[package-win] signtool.exe not found — install the Windows 10/11 SDK ' +
        '(includes signtool) or add it to PATH. Skipping signing.'
    )
    return
  }

  const args = ['sign', '/fd', 'SHA256', '/tr', timestamp, '/td', 'SHA256']
  if (hasPfx) {
    args.push('/f', pfx)
    if (typeof pfxPassword === 'string' && pfxPassword.length > 0) {
      args.push('/p', pfxPassword)
    }
  } else if (hasSubject) {
    // /n picks the cert from the Windows Cert Store by Subject Name. /sm
    // looks in LocalMachine; without it, signtool defaults to CurrentUser.
    args.push('/n', certSubject)
  }
  args.push(exePath)

  console.log(`[package-win] signing PresentOtter.exe via ${path.basename(signtool)}…`)
  const result = spawnSync(signtool, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`signtool exited with status ${result.status ?? 'unknown'}`)
  }
  console.log('[package-win] signed OK')
}

/**
 * Locate signtool.exe — try PATH first, then the standard Windows SDK
 * install paths.
 */
function locateSigntool() {
  try {
    const fromPath = execSync('where signtool', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)[0]
    if (typeof fromPath === 'string' && fs.existsSync(fromPath)) return fromPath
  } catch {
    // 'where' returns non-zero when nothing matches — fall through to scanning
  }

  const sdkRoots = [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin'
  ]
  for (const root of sdkRoots) {
    if (!fs.existsSync(root)) continue
    for (const versionDir of fs.readdirSync(root).sort().reverse()) {
      const candidate = path.join(root, versionDir, 'x64', 'signtool.exe')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
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
