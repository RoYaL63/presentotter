import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '../agents/ui/App'
import { Toolbar } from '../agents/ui/Toolbar'
import { Overlay } from '../agents/ui/Overlay'
import './index.css'

type Mode = 'toolbar' | 'overlay' | 'console'

function detectMode(): Mode {
  const hash = window.location.hash.replace('#', '').trim()
  if (hash === 'toolbar') return 'toolbar'
  if (hash === 'overlay') return 'overlay'
  return 'console'
}

const mode = detectMode()
document.documentElement.dataset['mode'] = mode

const Root: () => React.ReactElement = () => {
  if (mode === 'toolbar') return <Toolbar />
  if (mode === 'overlay') return <Overlay />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
