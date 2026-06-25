#!/usr/bin/env node
/**
 * scripts/release.js
 *
 * Prepares everything we need to cut a new GitHub Release for
 * PresentOtter:
 *
 *   1. Reads the version from package.json (single source of truth)
 *   2. Confirms the installer has actually been built for that version
 *   3. Computes a SHA-256 of the Setup.exe (for the release notes /
 *      Defender submission if we ever come back to it)
 *   4. Prints either:
 *        a) the `gh release create` command to run if gh is logged in
 *        b) a copy-paste-ready manual flow via the web UI
 *
 * It does NOT push or upload anything itself — releasing is still a
 * deliberate action you trigger yourself (`gh release create …` or the
 * UI). This script just removes the boilerplate.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execSync, spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const pkg = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
)
const appVersion = String(pkg.version)
const tag = `v${appVersion}`

const setupPath = path.join(projectRoot, 'release', `PresentOtter-Setup-${appVersion}.exe`)
if (!fs.existsSync(setupPath)) {
  console.error(`[release] No installer at ${setupPath}`)
  console.error(`[release] Run 'npm run installer:win' first.`)
  process.exit(1)
}

const stat = fs.statSync(setupPath)
const sha = sha256(setupPath)
const sizeMB = (stat.size / 1024 / 1024).toFixed(2)

const ghAvailable = (() => {
  const r = spawnSync('gh', ['--version'], { stdio: 'ignore' })
  return r.status === 0
})()

let currentSha = ''
try {
  currentSha = execSync('git rev-parse HEAD', { cwd: projectRoot }).toString().trim()
} catch {
  /* not a git repo? unlikely here */
}

console.log('')
console.log('=== PresentOtter release prep ===')
console.log(`  tag       : ${tag}`)
console.log(`  installer : ${setupPath}`)
console.log(`  size      : ${sizeMB} MB`)
console.log(`  sha256    : ${sha}`)
console.log(`  HEAD      : ${currentSha || '(unknown)'}`)
console.log('')

const notesPath = path.join(projectRoot, `RELEASE_NOTES_${tag}.md`)
const notes = renderNotes(tag, sha, sizeMB)
fs.writeFileSync(notesPath, notes, 'utf8')
console.log(`[release] wrote ${notesPath}`)
console.log('')

if (ghAvailable) {
  console.log('[release] gh CLI detected. To publish, run:')
  console.log('')
  console.log(`  git tag ${tag}`)
  console.log(`  git push origin ${tag}`)
  console.log(
    `  gh release create ${tag} "${setupPath}" --title "PresentOtter ${tag}" --notes-file "${notesPath}"`
  )
  console.log('')
} else {
  console.log('[release] gh CLI not found. Two paths:')
  console.log('')
  console.log('  A) Install + login:')
  console.log('       winget install GitHub.cli')
  console.log('       gh auth login')
  console.log(`       gh release create ${tag} "${setupPath}" --title "PresentOtter ${tag}" --notes-file "${notesPath}"`)
  console.log('')
  console.log('  B) Manual via the web UI:')
  console.log(`       1. git tag ${tag} && git push origin ${tag}`)
  console.log('       2. Open https://github.com/RoYaL63/presentotter/releases/new')
  console.log(`       3. Choose tag ${tag}, title "PresentOtter ${tag}"`)
  console.log(`       4. Drag-drop ${setupPath}`)
  console.log(`       5. Paste the body from ${notesPath}`)
  console.log('       6. Publish.')
  console.log('')
}

function renderNotes(tag, sha, sizeMB) {
  return [
    `# PresentOtter ${tag}`,
    '',
    'Open-source screen annotation toolbar + live sanitizer + screen recorder.',
    '',
    '## Installation (Windows)',
    '',
    '1. Télécharge `PresentOtter-Setup-' + appVersion + '.exe` depuis la section *Assets* ci-dessous.',
    '2. Double-clic → SmartScreen affichera *"Windows protected your PC"* → *More info* → *Run anyway*.',
    '3. Inno Setup déroule, installe par défaut sous `%LOCALAPPDATA%\\Programs\\PresentOtter\\`.',
    '4. Laisse *Lancer PresentOtter* coché à la fin pour démarrer tout de suite.',
    '',
    'Sur Win11 récent (Smart App Control = ON), le binaire est bloqué sans option. Désactive SAC dans Settings → Privacy & Security → Windows Security → App & browser control → Smart App Control, OU utilise `npm run dev` pour développer en local.',
    '',
    'Désinstallation : Settings → Apps → cherche *PresentOtter* → trois points → Uninstall.',
    '',
    '## Fichier',
    '',
    '| Champ | Valeur |',
    '|-------|--------|',
    '| Nom | `PresentOtter-Setup-' + appVersion + '.exe` |',
    '| Taille | ' + sizeMB + ' MB |',
    '| SHA-256 | `' + sha + '` |',
    '',
    '## Quick start',
    '',
    '- **Accueil** → bouton coral *Activer la barre d\'outils* pour faire apparaître la toolbar flottante par-dessus n\'importe quelle app.',
    '- **Triple-tap Alt** (de n\'importe où) → halo + traînée météorite sur le curseur.',
    '- **Sanitizer LIVE** → radar dans la toolbar, scanne en continu l\'écran et masque les secrets détectés (OpenAI / Stripe / GitHub / Slack / Anthropic / JWT / etc.).',
    '- **Enregistrer l\'écran** → carte coral sur l\'accueil → choisis source, audio, webcam (avec position / forme / Glass effect), fond personnalisé, démarre.',
    '',
    '🦦 Otterwise Solutions'
  ].join('\n')
}

function sha256(file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex').toUpperCase()
}
