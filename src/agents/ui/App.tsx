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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100">
      <TopBar />
      <main className="mx-auto">
        <CurrentPage />
      </main>
    </div>
  )
}
