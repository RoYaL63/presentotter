import { useEffect, type ReactElement } from 'react'
import { TopBar } from './components/TopBar'
import { Home } from './pages/Home'
import { Recording } from './pages/Recording'
import { Preview } from './pages/Preview'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { useNavStore, type PageName } from './stores/useNavStore'
import { registerUIEventListeners } from './eventListeners'

const PAGES: Record<PageName, () => ReactElement> = {
  home: Home,
  recording: Recording,
  preview: Preview,
  library: Library,
  settings: Settings
}

export function App() {
  const currentPage = useNavStore((s) => s.currentPage)

  useEffect(() => {
    const teardown = registerUIEventListeners()
    return teardown
  }, [])

  const CurrentPage = PAGES[currentPage]

  return (
    <div className="relative h-screen w-screen overflow-hidden font-sans antialiased text-otter-50">
      {/* Liquid background layer — animated floating orbs */}
      <div className="liquid-bg">
        <div
          className="liquid-orb animate-orb-float-1 bg-otter-500"
          style={{ width: '480px', height: '480px', top: '-120px', left: '-80px' }}
          aria-hidden
        />
        <div
          className="liquid-orb animate-orb-float-2 bg-fur-500"
          style={{ width: '360px', height: '360px', top: '40%', right: '-100px' }}
          aria-hidden
        />
        <div
          className="liquid-orb animate-orb-float-3 bg-otter-300"
          style={{
            width: '420px',
            height: '420px',
            bottom: '-140px',
            left: '40%',
            opacity: 0.22
          }}
          aria-hidden
        />
      </div>

      {/* Foreground app layer */}
      <div className="relative z-10 flex h-full flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div key={currentPage} className="animate-fade-in-up">
            <CurrentPage />
          </div>
        </main>
      </div>
    </div>
  )
}
