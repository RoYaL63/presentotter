# Gardien — Sanitizer Agent 🔒

## Responsabilités

Détecter et masquer automatiquement :
- Clés API (OpenAI, Anthropic, AWS, Anthropic, etc.)
- Tokens Bearer et JWT
- Variables d'environnement (.env)
- Numéros de carte bancaire
- Credentials n8n, Make, Airtable

## Interfaces clés

```typescript
SanitizePattern {
  name: string
  regex: RegExp
  replacement: string
  confidence: number
}

DetectedZone {
  type: 'api-key' | 'bearer-token' | 'jwt' | 'env-var' | 'credit-card' | 'credential'
  pattern: string
  frameIndices: number[]
  confidence: number
  bbox?: { x, y, width, height }
}

SanitizeReport {
  recordingId, totalFrames, zonesDetected
  patternMatches, analyzedAt
}

SanitizedRecording extends RawRecording {
  sanitizeReport, maskedFrames[]
}
```

## Events émis

- `sanitizer:analysis-started` — Début analyse
- `sanitizer:progress` — Progression (pourcentage, zones trouvées)
- `sanitizer:analysis-complete` — Fin avec SanitizeReport
- `sanitizer:applied` — SanitizedRecording générée
- `sanitizer:error` — Erreurs

## Implémentation

### src/agents/sanitizer/patterns.ts
Définition des patterns de détection (regex).

### src/agents/sanitizer/analyzer.ts
Analyse frame par frame avec OCR optionnel (Tesseract).

### src/agents/sanitizer/masker.ts
Application du masquage (blur, pixelate, solid color).

## Gate de validation

**G3 — Sanitizer core** : Tous les patterns clés doivent être détectés avec confidence >= 0.85.

## Notes de développement

- OCR (Tesseract) pour la détection textuelle
- Confidence score pour ajuster le masquage
- Caching des patterns compilés
- Tests sur du vrai contenu (pas de vraies clés API!)

## Tâches Phase 1

- [ ] Implémenter patterns regex pour API keys
- [ ] Intégrer Tesseract pour OCR optionnel
- [ ] Masqueur (blur ou pixelize)
- [ ] Tests unitaires sur patterns
- [ ] Valider G3 — Sanitizer core
