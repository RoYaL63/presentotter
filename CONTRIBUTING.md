# Contribuer à PresentOtter 🦦

Merci de l'intérêt pour PresentOtter ! Ce guide explique comment contribuer.

## Avant de commencer

Lis le [PRD](PRD.md) et le [BMAD](BMAD.md) pour comprendre l'architecture.
Chaque dossier `agents/*/` contient un `CLAUDE.md` qui documente le domaine.

## Types de contributions

### 🐛 Bug report
Ouvre une issue avec le template "Bug Report".
Inclus : OS, version, steps to reproduce, logs Electron.

### 💡 Feature request
Ouvre une issue avec le template "Feature Request".
Vérifie d'abord la roadmap dans README.md.

### 🔧 Pull Request

1. Fork le repo
2. Crée une branche : `git checkout -b feat/ma-feature`
3. Code dans le bon dossier `src/agents/<nom>/`
4. Tests unitaires obligatoires pour tout nouveau code
5. `npm run typecheck && npm run lint && npm test` doit passer
6. Ouvre une PR vers `main`

## Architecture — règle d'or

Chaque agent est isolé dans son dossier.
Les agents ne s'importent PAS directement.
Toute communication passe par `event-bus.ts`.
Tous les types viennent de `interfaces.ts`.

Si tu touches `interfaces.ts`, mentionne-le explicitement dans ta PR.

## Standards de code

- TypeScript strict (pas de `any`)
- Nommage en anglais pour le code, commentaires en français OK
- Tests Vitest pour toute logique métier
- Pas de `console.log` en production (utilise le logger)

## Environnement de dev

```bash
npm install
npm run dev
```

Windows requis pour tester la capture vidéo.
Le sanitizer et l'export peuvent être développés sur Mac/Linux.

## Questions ?

Issues GitHub : https://github.com/RoYaL63/presentotter/issues
