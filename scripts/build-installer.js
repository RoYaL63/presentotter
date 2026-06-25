#!/usr/bin/env node
/**
 * Build the classic Windows installer (Setup.exe) on top of the packaged
 * bundle. Runs Inno Setup's ISCC compiler against build/installer.iss
 * and outputs release/PresentOtter-Setup-<version>.exe.
 *
 * Expects `npm run pack:win` (or `pack:win` followed by this) to have
 * produced release/PresentOtter-win32-x64/PresentOtter.exe first.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const issPath = path.join(projectRoot, 'build', 'installer.iss')
const bundleDir = path.join(projectRoot, 'release', 'PresentOtter-win32-x64')

function locateIscc() {
  // 1) PATH
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter)
  for (const dir of pathDirs) {
    const candidate = path.join(dir, 'ISCC.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  // 2) Standard install locations
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env['ProgramFiles'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe')
  ]
  for (const c of candidates) {
    if (c.length > 0 && fs.existsSync(c)) return c
  }
  return null
}

function fail(message) {
  console.error(`[build-installer] ${message}`)
  process.exit(1)
}

if (!fs.existsSync(bundleDir)) {
  fail(
    `Bundle directory not found: ${bundleDir}\n` +
      `Run 'npm run pack:win' first to produce the unpacked Electron app.`
  )
}
if (!fs.existsSync(issPath)) {
  fail(`Inno Setup script not found: ${issPath}`)
}

const iscc = locateIscc()
if (iscc === null) {
  fail(
    'ISCC.exe (Inno Setup compiler) not found. Install Inno Setup 6 from\n' +
      'https://jrsoftware.org/isdl.php or via winget:\n' +
      '    winget install --id JRSoftware.InnoSetup\n' +
      'Then re-run this script.'
  )
}

// Pull the version from package.json and override the .iss #define at
// compile time so we never have to edit the installer script for a bump.
const pkg = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
)
const appVersion = String(pkg.version)

console.log(`[build-installer] using ISCC at ${iscc}`)
console.log(`[build-installer] compiling ${issPath} (v${appVersion}) …`)

const result = spawnSync(iscc, [`/DMyAppVersion=${appVersion}`, issPath], {
  cwd: path.dirname(issPath),
  stdio: 'inherit'
})

if (result.status !== 0) {
  fail(`ISCC exited with status ${result.status ?? 'unknown'}`)
}

// Print the produced file size
const outputs = fs
  .readdirSync(path.join(projectRoot, 'release'))
  .filter((f) => f.startsWith('PresentOtter-Setup-') && f.endsWith('.exe'))
for (const out of outputs) {
  const full = path.join(projectRoot, 'release', out)
  const size = fs.statSync(full).size
  console.log(
    `[build-installer] OK → ${full} (${(size / 1024 / 1024).toFixed(1)} MB)`
  )
}
