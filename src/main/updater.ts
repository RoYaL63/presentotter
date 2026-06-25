import { app, net, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

/**
 * Self-update via GitHub Releases.
 *
 * The repo at github.com/RoYaL63/presentotter publishes signed releases
 * with the Inno Setup installer as the only asset (PresentOtter-Setup-
 * <version>.exe). On demand, the user can:
 *
 *   1. checkForUpdate() — query the GitHub API, compare with the
 *      currently-running version, and report the verdict.
 *   2. downloadAndLaunch(url) — pull the .exe into the user's temp
 *      dir, then ask the shell to open it. The user runs through the
 *      installer wizard like any other update, the AppId stable in
 *      the .iss script makes Windows recognize it as a patch rather
 *      than a sidegrade.
 *
 * No background polling. No auto-install. Just a user-triggered "is
 * there a new version?" + a one-click download-and-launch shortcut.
 */

const RELEASES_API =
  'https://api.github.com/repos/RoYaL63/presentotter/releases/latest'

export interface UpdateCheck {
  currentVersion: string
  latestVersion: string
  upToDate: boolean
  downloadUrl: string | null
  downloadSizeMb: number | null
  htmlUrl: string | null
  publishedAt: string | null
}

interface GhAsset {
  name: string
  size: number
  browser_download_url: string
}
interface GhRelease {
  tag_name: string
  html_url: string
  published_at: string
  assets: GhAsset[]
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const currentVersion = app.getVersion()
  const json = await ghGet<GhRelease>(RELEASES_API)
  const latestVersion = (json.tag_name ?? '').replace(/^v/, '')
  // pick the Setup.exe asset
  const setupAsset = json.assets.find(
    (a) => /^PresentOtter-Setup-.*\.exe$/.test(a.name)
  )
  const upToDate = compareSemver(latestVersion, currentVersion) <= 0
  return {
    currentVersion,
    latestVersion,
    upToDate,
    downloadUrl: setupAsset?.browser_download_url ?? null,
    downloadSizeMb:
      setupAsset !== undefined ? Math.round((setupAsset.size / 1024 / 1024) * 10) / 10 : null,
    htmlUrl: json.html_url ?? null,
    publishedAt: json.published_at ?? null
  }
}

/**
 * Result of an in-app update attempt. `path` is always populated once
 * the download succeeds; `launched` tells the renderer whether the
 * shell actually ran the installer (false → Smart App Control / WDAC
 * blocked, the renderer should offer to open Explorer at the file
 * so the user can right-click → Properties → Unblock manually).
 */
export interface UpdateLaunchResult {
  /** Absolute path of the downloaded .exe on disk. */
  path: string
  /** True if `shell.openPath` reported success. False means Windows
   *  rejected the launch (most commonly because the binary doesn't
   *  have an established reputation with Smart App Control). */
  launched: boolean
  /** When `launched` is false, the underlying shell error string so
   *  we can surface it in the UI. */
  launchError?: string
}

/**
 * Download the given .exe to %TEMP%\presentotter-updates\ then try to
 * launch it via the OS shell. Returns the file path + whether the
 * launch actually went through. Never throws on launch failure — the
 * renderer needs the path so it can offer "open the folder" instead.
 */
export async function downloadAndLaunch(
  url: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<UpdateLaunchResult> {
  const tempDir = path.join(app.getPath('temp'), 'presentotter-updates')
  await fsp.mkdir(tempDir, { recursive: true })
  const filename = url.split('/').pop() ?? 'PresentOtter-Setup.exe'
  const dest = path.join(tempDir, filename)

  await streamToFile(url, dest, onProgress)
  // shell.openPath returns '' on success, an error string otherwise.
  // Smart App Control / WDAC blocks land here with a non-empty string;
  // do NOT throw — the renderer needs the path to fall back to
  // "open the containing folder so the user can unblock manually".
  const err = await shell.openPath(dest)
  if (err.length > 0) {
    return { path: dest, launched: false, launchError: err }
  }
  return { path: dest, launched: true }
}

/**
 * Reveal the (already downloaded) installer in Explorer so the user
 * can right-click → Properties → Unblock when Smart App Control kept
 * the shell launcher from running it. Used by the renderer's "open
 * folder" fallback button.
 */
export async function revealInExplorer(filePath: string): Promise<void> {
  shell.showItemInFolder(filePath)
}

// --------- helpers ---------

/** GET a JSON resource through Electron's `net` (no CORS, follows redirects). */
function ghGet<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow', method: 'GET' })
    // GitHub requires a User-Agent header on API requests.
    req.setHeader('User-Agent', 'PresentOtter-Updater')
    req.setHeader('Accept', 'application/vnd.github+json')
    const chunks: Buffer[] = []
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`GitHub API ${res.statusCode} on ${url}`))
        return
      }
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve(JSON.parse(body) as T)
        } catch (err) {
          reject(err as Error)
        }
      })
      res.on('error', (err: Error) => reject(err))
    })
    req.on('error', (err) => reject(err))
    req.end()
  })
}

/** Stream a URL into a file on disk via Electron's net. */
function streamToFile(
  url: string,
  dest: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow', method: 'GET' })
    req.setHeader('User-Agent', 'PresentOtter-Updater')
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`Download HTTP ${res.statusCode}`))
        return
      }
      const totalHeader = res.headers['content-length']
      const total = Array.isArray(totalHeader)
        ? Number(totalHeader[0] ?? 0)
        : Number(totalHeader ?? 0)
      let downloaded = 0
      const out = createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        out.write(chunk)
        if (onProgress !== undefined) onProgress(downloaded, total)
      })
      res.on('end', () => {
        out.end()
        out.on('finish', () => resolve())
      })
      res.on('error', (err: Error) => {
        out.destroy()
        reject(err)
      })
    })
    req.on('error', (err) => reject(err))
    req.end()
  })
}

/**
 * Naive semver compare — returns positive if `a > b`, negative if a < b,
 * 0 if equal. Strips a leading "v" and ignores non-numeric suffixes.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}
