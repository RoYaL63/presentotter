#!/usr/bin/env node
/**
 * Generate build/icon.ico (and build/icon.png) from the app mascot so the
 * packaged PresentOtter.exe carries the otter on the desktop, the Start
 * menu, the "Apps & features" list and every shortcut.
 *
 * Why a script rather than a committed binary edited by hand:
 *   The only source artwork we ship is src/renderer/assets/mascot.webp.
 *   WebP can't be decoded by Node or by Electron's nativeImage (main
 *   process), so we borrow Chromium: a hidden BrowserWindow decodes the
 *   webp, letterboxes it onto a square transparent canvas (the mascot is
 *   1024×1536 portrait — stretching it to a square would squash the otter)
 *   and re-encodes each icon size to PNG. We then wrap those PNGs in an ICO
 *   container (PNG-compressed entries, supported on Windows Vista+).
 *
 * Run: node scripts/make-icon.js   (electron resolves from devDependencies)
 */

const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(PROJECT_ROOT, 'src', 'renderer', 'assets', 'mascot.webp')
const OUT_ICO = path.join(PROJECT_ROOT, 'build', 'icon.ico')
const OUT_PNG = path.join(PROJECT_ROOT, 'build', 'icon.png')

/** Standard Windows icon sizes. 256 is rendered as a PNG entry in the ICO. */
const SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * In-page: decode the source (a webp data URL), then for each size draw it
 * centered on a transparent square canvas preserving aspect ratio, and
 * return a base64 PNG. Runs inside Chromium so webp + high-quality
 * downscaling are free.
 */
function rasterizeInPage(dataUrl, sizes) {
  const img = new Image()
  img.src = dataUrl
  return img.decode().then(() => {
    return sizes.map((size) => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // Contain: fit the whole mascot inside the square, transparent margins.
      const scale = Math.min(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      return canvas.toDataURL('image/png').split(',')[1]
    })
  })
}

/** Assemble a multi-image ICO from PNG buffers (one per size). */
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  pngBuffers.forEach((png, i) => {
    const size = sizes[i]
    const e = 16 * i
    dir.writeUInt8(size >= 256 ? 0 : size, e + 0) // width (0 => 256)
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1) // height (0 => 256)
    dir.writeUInt8(0, e + 2) // palette
    dir.writeUInt8(0, e + 3) // reserved
    dir.writeUInt16LE(1, e + 4) // color planes
    dir.writeUInt16LE(32, e + 6) // bits per pixel
    dir.writeUInt32LE(png.length, e + 8) // bytes in resource
    dir.writeUInt32LE(offset, e + 12) // offset from file start
    offset += png.length
  })

  return Buffer.concat([header, dir, ...pngBuffers])
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Source artwork not found: ${SOURCE}`)
  }
  const webpDataUrl =
    'data:image/webp;base64,' + fs.readFileSync(SOURCE).toString('base64')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: false }
  })
  await win.loadURL('about:blank')

  const base64Pngs = await win.webContents.executeJavaScript(
    `(${rasterizeInPage.toString()})(${JSON.stringify(webpDataUrl)}, ${JSON.stringify(SIZES)})`
  )

  const pngBuffers = base64Pngs.map((b64) => Buffer.from(b64, 'base64'))
  const ico = buildIco(pngBuffers, SIZES)

  fs.writeFileSync(OUT_ICO, ico)
  // The 256px PNG doubles as a cross-platform icon source if ever needed.
  fs.writeFileSync(OUT_PNG, pngBuffers[pngBuffers.length - 1])

  console.log(
    `[make-icon] wrote ${path.relative(PROJECT_ROOT, OUT_ICO)} ` +
      `(${SIZES.join('/')} px, ${(ico.length / 1024).toFixed(1)} KB)`
  )
  win.destroy()
}

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((err) => {
    console.error('[make-icon] failed:', err)
    app.exit(1)
  })
