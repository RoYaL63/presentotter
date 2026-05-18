import { useState } from 'react'
import type { CaptureConfig } from '@interfaces'
import { RecordButton } from '../components/RecordButton'
import { SourceSelector } from '../components/SourceSelector'
import { useNavStore } from '../stores/useNavStore'
import { orchestrator } from '../orchestrator'

const DEFAULT_CONFIG: CaptureConfig = {
  source: 'screen',
  width: 1920,
  height: 1080,
  fps: 30,
  audioInputs: {
    system: true,
    microphone: true
  }
}

export function Home() {
  const [source, setSource] = useState<CaptureConfig['source']>('screen')
  const navigate = useNavStore((s) => s.navigate)

  const handleStart = async () => {
    const config: CaptureConfig = { ...DEFAULT_CONFIG, source }
    try {
      await orchestrator.startCapture(config)
      navigate('recording')
    } catch {
      // l'event bus 'capture:error' sera capté ailleurs ; pas de UI feedback P0
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-slate-100">Nouvel enregistrement</h1>
        <p className="text-slate-400">Choisis ta source de capture, puis démarre l'enregistrement.</p>
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Source</h2>
        <SourceSelector selected={source} onSelect={setSource} />
      </div>

      <div className="flex flex-col items-center gap-3 pt-4">
        <RecordButton onStart={handleStart} onStop={() => undefined} />
        <p className="text-sm text-slate-400">Démarrer l'enregistrement</p>
      </div>
    </section>
  )
}
