import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const App = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-white mb-4">PresentOtter 🦦</h1>
          <p className="text-xl text-slate-300">Open source screen recorder for no-code educators</p>
          <p className="text-slate-400 mt-4">v0.1.0-alpha — Bootstrap phase</p>
        </div>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
