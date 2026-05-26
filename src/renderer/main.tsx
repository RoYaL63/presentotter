import React from 'react'
import ReactDOM from 'react-dom/client'
import { Home } from '../agents/ui/Home'
import { Toolbar } from '../agents/ui/Toolbar'
import { Overlay } from '../agents/ui/Overlay'
import { Mirror } from '../agents/ui/Mirror'
import './index.css'

/**
 * Window-mode dispatcher.
 *
 * The Electron main process boots four kinds of BrowserWindows, identified
 * by a hash in the renderer URL:
 *
 *   #toolbar  → floating frameless toolbar (annotation tools + live sanitizer)
 *   #overlay  → fullscreen transparent canvas (annotations + cursor halo)
 *   #mirror   → framed window that shows a live composited screen feed,
 *               meant to be shared inside Meet/Zoom so participants see
 *               annotations even in tab/window-share modes.
 *   anything else → Home (the single main window, with internal nav between
 *                   Accueil / Outils / Bibliothèque / Paramètres)
 */
type Mode = 'home' | 'toolbar' | 'overlay' | 'mirror'

function detectMode(): Mode {
  const hash = window.location.hash.replace('#', '').trim()
  if (hash === 'toolbar') return 'toolbar'
  if (hash === 'overlay') return 'overlay'
  if (hash === 'mirror') return 'mirror'
  return 'home'
}

const mode = detectMode()
document.documentElement.dataset['mode'] = mode

const Root: () => React.ReactElement = () => {
  if (mode === 'toolbar') return <Toolbar />
  if (mode === 'overlay') return <Overlay />
  if (mode === 'mirror') return <Mirror />
  return <Home />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
