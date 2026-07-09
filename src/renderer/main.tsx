import React from 'react'
import ReactDOM from 'react-dom/client'
import { Home } from '../agents/ui/Home'
import { Toolbar } from '../agents/ui/Toolbar'
import { Overlay } from '../agents/ui/Overlay'
import { CaptureOverlay } from '../agents/ui/CaptureOverlay'
import { CaptureEditor } from '../agents/ui/CaptureEditor'
import { RegionRecorder } from '../agents/ui/RegionRecorder'
import { VideoEditor } from '../agents/ui/VideoEditor'
import mascotUrl from './assets/mascot.webp'
import './index.css'

/**
 * Window-mode dispatcher.
 *
 * The Electron main process boots three kinds of BrowserWindows, identified
 * by a hash in the renderer URL:
 *
 *   #toolbar  → floating frameless toolbar (annotation tools + live sanitizer)
 *   #overlay  → fullscreen transparent canvas (annotations + cursor halo)
 *   anything else → Home (the single main window, with internal nav between
 *                   Accueil / Outils / Bibliothèque / Miroir Meet / Paramètres)
 *
 * The Mirror is a SECTION of Home, not its own window — that way the user
 * shares the Home window in Meet (mode "Une fenêtre") with the Mirror
 * section displayed.
 */
type Mode =
  | 'home'
  | 'toolbar'
  | 'overlay'
  | 'capture'
  | 'editor'
  | 'recorder'
  | 'video-editor'

function detectMode(): Mode {
  const hash = window.location.hash.replace('#', '').trim()
  if (hash === 'toolbar') return 'toolbar'
  if (hash === 'overlay') return 'overlay'
  if (hash === 'capture') return 'capture'
  if (hash === 'editor') return 'editor'
  if (hash === 'recorder') return 'recorder'
  if (hash === 'video-editor') return 'video-editor'
  return 'home'
}

const mode = detectMode()
document.documentElement.dataset['mode'] = mode

/**
 * The main process can't decode the .webp mascot for the tray / taskbar
 * icon. So in the Home window (which Chromium renders, webp included) we
 * rasterize the mascot to a PNG once and hand it to main, which caches it
 * and uses it everywhere. No native dependency, no extra asset file.
 */
function sendAppIconToMain(): void {
  try {
    const img = new Image()
    img.src = mascotUrl
    void img
      .decode()
      .then(() => {
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (ctx === null) return
        // The mascot is square; draw it to fill the icon canvas.
        ctx.drawImage(img, 0, 0, size, size)
        window.api?.setAppIcon(canvas.toDataURL('image/png'))
      })
      .catch(() => {
        /* mascot failed to decode — main keeps its fallback icon */
      })
  } catch {
    /* ignore */
  }
}

if (mode === 'home') {
  sendAppIconToMain()
}

const Root: () => React.ReactElement = () => {
  if (mode === 'toolbar') return <Toolbar />
  if (mode === 'overlay') return <Overlay />
  if (mode === 'capture') return <CaptureOverlay />
  if (mode === 'editor') return <CaptureEditor />
  if (mode === 'recorder') return <RegionRecorder />
  if (mode === 'video-editor') return <VideoEditor />
  return <Home />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
