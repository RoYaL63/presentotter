<div align="center">
  <img src="build/icon.png" alt="PresentOtter" width="120" />
  
  # PresentOtter 🦦
  
  **Enregistrez votre écran. Annotez en direct. Ne leaked jamais vos secrets.**
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
  [![Windows](https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows)](https://github.com/RoYaL63/presentotter/releases)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
  [![Electron](https://img.shields.io/badge/Electron-29-9feaf9?logo=electron)](https://www.electronjs.org/)
  [![Made by OTTERWISE](https://img.shields.io/badge/made%20by-OTTERWISE-00D4A0)](https://otterwise.fr)
  
  [Télécharger](#installation) · [Documentation](docs/) · [Contribuer](CONTRIBUTING.md) · [Discord](https://discord.gg/otterwise)
</div>

---

## Pourquoi PresentOtter ?

Tu crées des tutoriels Make, n8n, Airtable ou Bubble. Tu enregistres ton écran.
Et là — catastrophe — ta clé API OpenAI apparaît en clair dans la vidéo.

PresentOtter résout ça avec un **sanitizer automatique** qui détecte et masque
les credentials avant l'export. Jamais de secret dans tes vidéos.

## Features

### 🎥 Capture
- Écran entier, région personnalisée, ou fenêtre spécifique
- Audio système (loopback) + micro
- 30 ou 60 fps, résolution native ou personnalisée
- Bookmarks temporels pendant l'enregistrement

### 🖊️ Annotations en direct
- Dessin libre, rectangles, cercles, flèches
- Texte overlay positionnable
- Spotlight (focus sur une zone)
- Numéros d'étapes auto-incrémentés
- Cursor tracing : highlight, click flash, traînée

### 🔒 Sanitizer automatique
Détecte et masque automatiquement :
- Clés API (OpenAI, Anthropic, AWS, etc.)
- Tokens Bearer et JWT
- Variables d'environnement (.env)
- Numéros de carte bancaire
- Credentials n8n, Make, Airtable

### 📤 Export
- MP4 (H.264 / H.265)
- WebM (VP9)
- GIF animé
- Presets optimisés (tutorial HD, démo légère, social GIF)

## Installation

### Méthode recommandée — Setup.exe depuis les Releases

👉 **[Télécharger la dernière version](https://github.com/RoYaL63/presentotter/releases/latest)**

1. Récupère `PresentOtter-Setup-x.y.z.exe` dans la section *Assets* de la release.
2. Double-clic. SmartScreen va probablement dire *« Windows protected your PC »* → clique **More info** → **Run anyway**.
3. L'installeur Inno Setup s'ouvre. Par défaut, install per-user dans `%LOCALAPPDATA%\Programs\PresentOtter\` (pas d'UAC, pas d'admin requis).
4. Garde *« Lancer PresentOtter »* coché à la fin.

**Mise à jour** : télécharge la nouvelle release et lance le nouveau Setup. Il écrase l'install précédente proprement (l'AppId est stable, donc Windows reconnaît une mise à jour, pas une nouvelle install).

**Désinstallation** : Settings → Apps → cherche *PresentOtter* → trois points → Uninstall. Wipe également `%LOCALAPPDATA%\PresentOtter\` (cache + préférences).

### Si Smart App Control bloque l'install (Win11)

Le binaire n'est pas signé (alpha open-source, pas de budget EV cert). Sur Win11 récent avec SAC = ON, Windows refuse sans option de bypass. Deux solutions :

- **Désactiver SAC** : Settings → Privacy & Security → Windows Security → App & browser control → Smart App Control settings → Off. ⚠️ Irréversible sans réinstaller Windows.
- **Build depuis les sources et `npm run dev`** : l'électron de dev est signé par GitHub, SAC le laisse passer (cf. ci-dessous).

### Build depuis les sources

Prérequis : Node.js 20+, Windows 10/11.

```bash
git clone https://github.com/RoYaL63/presentotter
cd presentotter
npm install
npm run dev          # dev avec hot reload (signé GitHub, OK avec SAC)
```

Régénérer l'installeur localement :

```bash
npm run installer:win    # produit release/PresentOtter-Setup-<version>.exe
npm run release          # imprime le hash + commandes pour publier sur GitHub Releases
```

## Raccourcis clavier

Les annotations passent par la toolbar flottante (à activer depuis l'accueil) :

| Action | Raccourci |
|---|---|
| Sélection / passe-through | Alt+S |
| Crayon | Alt+P |
| Rectangle | Alt+R |
| Cercle | Alt+O |
| Flèche | Alt+A |
| Texte | Alt+T |
| Spotlight | Alt+L |
| Undo dernier trait | Alt+Z |
| Tout effacer | Alt+Shift+C |
| Masquer / montrer overlays | Alt+H |
| Masquer / montrer toolbar | Alt+B |
| Repasser en passe-through | Escape |
| **Curseur en évidence (global)** | **Triple-tap Alt** |

## Contribuer

PresentOtter est open source et les contributions sont les bienvenues !
Lis [CONTRIBUTING.md](CONTRIBUTING.md) pour commencer.

## Roadmap

- [ ] v0.1 — Capture + Sanitizer + Export basique
- [ ] v0.2 — Annotations complètes + Library
- [ ] v0.3 — Webcam PiP + Audio avancé
- [ ] v1.0 — Release stable
- [ ] v2.0 — Éditeur vidéo basique + upload cloud

## Stack technique

| Composant | Technologie |
|---|---|
| App | Electron 29 + React 18 |
| Language | TypeScript strict |
| UI | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Capture | Windows Graphics Capture API |
| Encodage | FFmpeg (bundlé) |
| OCR | Tesseract 5.x |
| DB locale | SQLite (better-sqlite3) |

## Licence

MIT — [voir LICENSE](LICENSE)

Fait avec 🦦 par [OTTERWISE Solutions](https://no-code-pedia-fr.lovable.app/)
