# Testeur — Integration Tests 🧪

## Responsabilités

Tests E2E validant tous les use cases :

### UC-01 : Capture simple
1. Démarrer enregistrement écran
2. Attendre 5 secondes
3. Arrêter
4. Valider RawRecording complète avec frames

### UC-02 : Sanitizer masque API key
1. Enregistrer écran avec clé API visible
2. Analyser avec Gardien
3. Valider que la zone est détectée et masquée
4. Exporter en MP4
5. Valider que le fichier ne contient pas la clé

### UC-03 : Export complet
1. Enregistrement + annotations
2. Passer par Sanitizer
3. Exporter en MP4, WebM, GIF
4. Valider que les 3 fichiers existent et sont lisibles
5. Vérifier durées correctes

### UC-04 : Library + Métadonnées
1. Créer 3 enregistrements
2. Tagger chacun
3. Renommer
4. Supprimer l'un
5. Valider DB et fichiers en synchro

## Framework

**Vitest** avec Electron mock.

```typescript
// integration-tests/uc-01.test.ts
describe('UC-01 : Capture simple', () => {
  it('should capture frames without corruption', async () => {
    // Test logic
  })
})
```

## Fixtures

- Mock Windows Graphics API (si pas Windows)
- Dummy video frames (10 frames RGBA)
- Temp directories pour tests

## Gate de validation

**G5 — E2E validé** : Tous les UC doivent passer.

## Notes

- CI/CD runs sur Windows (GitHub Actions)
- Tests sont isolés (pas de fichiers résiduels)
- Coverage >= 70%

## Tâches Phase 4

- [ ] Implémenter UC-01 test
- [ ] Implémenter UC-02 test
- [ ] Implémenter UC-03 test
- [ ] Implémenter UC-04 test
- [ ] Fixtures et mocks
- [ ] Valider G5 — E2E
