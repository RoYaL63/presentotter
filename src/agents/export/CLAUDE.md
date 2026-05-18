# Castor — Export Agent 📤

## Responsabilités

Encoder et exporter vers multiples formats :
- **MP4** (H.264 / H.265) — Default, compatible universel
- **WebM** (VP9) — Web-first, meilleure compression
- **GIF** — Social media, courtes démos
- Presets optimisés (tutorial HD, démo légère, social GIF)
- Watermark optionnel OTTERWISE

## Interfaces clés

```typescript
ExportFormat = 'mp4' | 'webm' | 'gif'

ExportConfig {
  format: ExportFormat
  quality: 'low' | 'medium' | 'high' | 'lossless'
  preset?: ExportPreset
  outputPath: string
}

ExportPreset {
  name: string
  codec: string
  bitrate: string
  scale?: string
  fps?: number
}
```

## Events émis

- `export:started` — Début export
- `export:progress` — Progression (%, ETA, frame actuelle)
- `export:complete` — Fin avec chemin + taille + durée
- `export:cancelled` — Annulation utilisateur
- `export:error` — Erreur

## Implémentation

### src/agents/export/ffmpeg-encoder.ts
Intégration fluent-ffmpeg pour encodage.

### src/agents/export/presets.ts
Définition des presets (bitrate, codec, options FFmpeg).

### src/agents/export/watermark.ts
Application watermark optionnel.

## Gate de validation

Pas de gate séparé — Validé dans G5 (E2E).

## Notes de développement

- FFmpeg bundlé dans `resources/ffmpeg/`
- Streaming frames vers FFmpeg (pas de fichier intermédiaire)
- Annulation async (graceful shutdown FFmpeg)
- Gestion mémoire : streaming, pas de buffering complet

## Tâches Phase 3

- [ ] Intégrer fluent-ffmpeg
- [ ] MP4 H.264 (preset default)
- [ ] WebM VP9 (pour web)
- [ ] GIF export
- [ ] Presets optimisés
- [ ] Watermark optionnel
- [ ] Gestion cancel/pause
- [ ] Tests E2E exports
