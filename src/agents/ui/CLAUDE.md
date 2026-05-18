# Vitrine — UI Agent 🎬

## Responsabilités

Interface utilisateur Electron + React :
- Écran principal (record, pause, stop)
- Sélecteur de source (écran, région, fenêtre)
- Mode annotations (toolbar)
- Preview en live
- Settings et library
- Système de notifications

## Architecture

### Src/renderer/pages/
- `Home.tsx` — Page d'accueil (sélection source + actions)
- `Recording.tsx` — Pendant l'enregistrement
- `Preview.tsx` — Preview post-enregistrement
- `Settings.tsx` — Configuration
- `Library.tsx` — Biblothèque des enregistrements

### src/renderer/components/
- `RecordButton.tsx` — Bouton enregistrement
- `AnnotationToolbar.tsx` — Mode annotations
- `VideoPreview.tsx` — Aperçu vidéo
- `SourceSelector.tsx` — Choix source (écran, région, fenêtre)

## State Management

Zustand stores :
- `useRecordingStore` — État enregistrement (isRecording, elapsed, sessionId)
- `useAnnotationStore` — Mode annotations, couleur, outils
- `useLibraryStore` — Liste recordings, filtres

## Events écoutés

- `capture:started`, `capture:paused`, `capture:stopped`
- `sanitizer:progress`, `sanitizer:applied`
- `export:progress`, `export:complete`
- `library:recording-deleted`, `library:recording-renamed`

## Gate de validation

**G4 — UI skeleton** : Tous les écrans en place, capture démarrable.

## Notes de développement

- Tailwind CSS + shadcn/ui pour composants
- Framer Motion pour animations
- Lucide React pour icônes
- Dark mode support (prefers-color-scheme)
- Responsive (Windows, 1080p minimum)

## Tâches Phase 1

- [ ] Pages React basiques (Home, Recording, Library)
- [ ] Zustand stores pour state
- [ ] Event listeners complets
- [ ] Styling Tailwind (light + dark)
- [ ] Valider G4 — UI skeleton

## Tâches Phase 3

- [ ] Intégration Plongeon (capture réelle)
- [ ] Intégration Gardien (sanitizer UI)
- [ ] Intégration Castor (export UI)
- [ ] Polish animations
