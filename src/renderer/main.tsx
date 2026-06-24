import React from 'react'
import ReactDOM from 'react-dom/client'
import { Home } from '../agents/ui/Home'
import { Toolbar } from '../agents/ui/Toolbar'
import { Overlay } from '../agents/ui/Overlay'
import { CaptureOverlay } from '../agents/ui/CaptureOverlay'
import { CaptureEditor } from '../agents/ui/CaptureEditor'
import { RegionRecorder } from '../agents/ui/RegionRecorder'
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
type Mode = 'home' | 'toolbar' | 'overlay' | 'capture' | 'editor' | 'recorder'

function detectMode(): Mode {
  const hash = window.location.hash.replace('#', '').trim()
  if (hash === 'toolbar') return 'toolbar'
  if (hash === 'overlay') return 'overlay'
  if (hash === 'capture') return 'capture'
  if (hash === 'editor') return 'editor'
  if (hash === 'recorder') return 'recorder'
  return 'home'
}

const mode = detectMode()
document.documentElement.dataset['mode'] = mode

const Root: () => React.ReactElement = () => {
  if (mode === 'toolbar') return <Toolbar />
  if (mode === 'overlay') return <Overlay />
  if (mode === 'capture') return <CaptureOverlay />
  if (mode === 'editor') return <CaptureEditor />
  if (mode === 'recorder') return <RegionRecorder />
  return <Home />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
