/**
 * P0 mock — Phase 3 intégrera WASAPI loopback via node-windows-audio-capture
 * ou équivalent (naudiodon / electron MediaRecorder). Pour l'instant on
 * simule un stream qui retourne un Buffer vide à l'arrêt.
 */

type AudioStatus = 'idle' | 'active' | 'paused' | 'stopped'

export interface AudioInputs {
  system: boolean
  microphone: boolean
}

export class AudioCapturer {
  private status: AudioStatus = 'idle'

  constructor(private readonly inputs: AudioInputs) {}

  async start(): Promise<void> {
    // Aucun device réel ouvert en P0. On marque juste l'état.
    this.status = 'active'
  }

  pause(): void {
    if (this.status === 'active') this.status = 'paused'
  }

  resume(): void {
    if (this.status === 'paused') this.status = 'active'
  }

  async stop(): Promise<Buffer> {
    this.status = 'stopped'
    // Buffer vide — sera remplacé par PCM/AAC encodé en Phase 3.
    return Buffer.alloc(0)
  }

  getStatus(): AudioStatus {
    return this.status
  }

  getInputs(): AudioInputs {
    return this.inputs
  }
}
