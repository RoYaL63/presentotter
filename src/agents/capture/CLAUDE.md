# Plongeon — Capture Agent 🌊

## Responsabilités

Capture vidéo/audio depuis :
- Écran entier
- Région personnalisée (rectangle)
- Fenêtre spécifique
- Audio système (loopback) + microphone

## Interfaces clés

```typescript
CaptureConfig {
  source: 'screen' | 'region' | 'window'
  width, height, fps
  audioInputs: { system, microphone }
}

VideoFrame {
  data: Buffer (RGBA ou YUV420)
  width, height, timestamp
}

RawRecording {
  id, frames[], audioData
  duration, bookmarks[], config
}
```

## Events émis

- `capture:started` — Démarrage avec config
- `capture:frame` — Chaque frame capturée
- `capture:paused` / `capture:resumed`
- `capture:stopped` — Arrêt avec RawRecording complète
- `capture:bookmark` — Bookmarks utilisateur
- `capture:error` — Erreurs (recoverable ou non)

## Implémentation

### src/agents/capture/capturer.ts
Module principal de capture Windows Graphics API.

### src/agents/capture/audio.ts
Gestion audio système + micro avec Web Audio API.

### src/agents/capture/bookmarks.ts
Gestion temporelle des bookmarks.

## Gate de validation

**G2 — Capture stable** : Toutes les captures doivent être stables, aucune corruption de frame.

## Notes de développement

- Windows 10/11 requis pour Graphics Capture API
- Format YUV420 pour l'efficacité (convertir en RGBA à la demande)
- Buffer pooling pour éviter GC à la capture
- Tests sur multi-écrans

## Tâches Phase 1

- [ ] Implémenter Windows Graphics Capture
- [ ] Gérer les changements de résolution
- [ ] Audio loopback (WASAPI)
- [ ] Tests unitaires (sans Windows API = mock)
- [ ] Valider G2 — Capture stable
