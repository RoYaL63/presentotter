# Pinceau — Annotation Agent 🖌️

## Responsabilités

Annotations en direct pendant l'enregistrement :
- Dessin libre (freeform, brush)
- Formes (rectangle, cercle, flèche)
- Texte overlay avec positionnement
- Spotlight (focus zone)
- Numéros d'étapes auto-incrémentés
- Cursor tracing (highlight, click flash, traînée)

## Interfaces clés

```typescript
AnnotationType = 'freeform' | 'rectangle' | 'circle' | 'arrow' | 'text' | 'spotlight'

Annotation {
  id, type, color, opacity
  startFrame, endFrame
  points?: Array<{ x, y }>  // Pour freeform/arrow
  text?: string              // Pour text
  bbox?: { x, y, width, height }
}
```

## Events écoutés/émis

Écoutés :
- `capture:frame` — Appliquer annotations
- `capture:started` / `capture:stopped`

Émis :
- `annotation:added` — Annotation créée
- `annotation:removed` — Annotation supprimée
- `annotation:updated` — Annotation modifiée

## Implémentation

### src/agents/annotate/renderer.ts
Rendu des annotations sur VideoFrame (dessin 2D canvas-like).

### src/agents/annotate/storage.ts
Persistance des annotations en SQLite (pour édition post-export).

### src/agents/annotate/cursor-tracker.ts
Détection et traçage du curseur.

## Gate de validation

Pas de gate séparé — Intégré à G5 (E2E).

## Notes de développement

- Annotations appliquées en temps réel aux frames
- Persistance : permettre édition après enregistrement
- Performance : ne pas lagguer la capture
- Cursor detection : optionnel/paramétrable

## Tâches Phase 2

- [ ] Implémenter dessin libre (freeform)
- [ ] Formes (rectangle, cercle, flèche)
- [ ] Texte overlay
- [ ] Spotlight (zone focalisée avec dimming)
- [ ] Cursor tracking
- [ ] Stockage annotations
- [ ] Tests E2E dessin/annotations
