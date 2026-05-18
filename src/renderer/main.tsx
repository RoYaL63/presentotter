import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '../agents/ui/App'
import { Home } from '../agents/ui/Home'
import { Toolbar } from '../agents/ui/Toolbar'
import { Overlay } from '../agents/ui/Overlay'
import './index.css'

type Mode = 'home' | 'toolbar' | 'overlay' | 'console'

function detectMode(): Mode {
  const hash = window.location.hash.replace('#', '').trim()
  if (hash === 'toolbar') return 'toolbar'
  if (hash === 'overlay') return 'overlay'
  if (hash === 'console') return 'console'
  return 'home'
}

const mode = detectMode()
document.documentElement.dataset['mode'] = mode

const Root: () => React.ReactElement = () => {
  if (mode === 'toolbar') return <Toolbar />
  if (mode === 'overlay') return <Overlay />
  if (mode === 'console') return <App />
  return <Home />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
