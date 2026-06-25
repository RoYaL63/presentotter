<div align="center">
  <img src="src/renderer/assets/mascot.webp" alt="PresentOtter" width="120" />

  # PresentOtter 🦦

  **Annote ton écran en direct, masque tes secrets pendant un partage, enregistre proprement.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
  [![Windows](https://img.shields.io/badge/Windows-10%2F11-blue?logo=windows)](https://github.com/RoYaL63/presentotter/releases)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
  [![Electron](https://img.shields.io/badge/Electron-29-9feaf9?logo=electron)](https://www.electronjs.org/)

  [Télécharger](#installation) · [Comment ça marche](#comment-ça-marche-vraiment-la-partie-pédagogique) · [Historique](#historique-des-versions) · [Contribuer](CONTRIBUTING.md)
</div>

---

## C'est quoi PresentOtter

Une barre d'outils flottante pour Windows qui se pose par-dessus n'importe quelle application pendant que tu présentes ou que tu enregistres. Trois usages principaux :

1. **Annoter en direct** : crayon, formes, flèches, texte, spotlight, surligneur éphémère, par-dessus le bureau ou l'app que tu montres.
2. **Masquer les secrets en direct** : un scan continu de l'écran repère les clés API, tokens et identifiants, et pose un masque dessus avant que ton audience ne les voie. Plus un outil manuel pour flouter n'importe quelle zone instantanément.
3. **Enregistrer l'écran** : capture écran/fenêtre/onglet, audio, webcam en incrustation, fond personnalisé, export MP4/WebM.

Le tout open source, sans compte, sans cloud, tout en local.

> **Note d'honnêteté.** Ce projet est en développement actif et public. Il avance par petites versions fréquentes. Ce README explique aussi **ce qui ne marche pas encore et pourquoi**, parce que c'est souvent plus instructif que la liste des features.

---

## Fonctionnalités

### Barre d'outils flottante
- Capsule qui flotte au-dessus de toutes les apps, déplaçable depuis n'importe quel bord.
- Mode **horizontal** (haut d'écran) ou **vertical** (dock contre un bord), au choix.
- Réductible en bulle déplaçable.
- Reste lisible sur n'importe quel fond de bureau (clair ou sombre).

### Annotation
- Crayon, rectangle, cercle, flèche, texte positionnable.
- **Spotlight** : assombrit l'écran sauf un cercle qui suit le curseur.
- **Surligneur éphémère** : le tracé s'efface tout seul après quelques secondes, du premier coup de crayon vers le dernier. Durée réglable.
- **Curseur en évidence** : halo + traînée façon météorite, activable de partout par triple-tap sur Alt.
- Palette de 14 couleurs (douces + vives).
- Undo au clic droit.

### Masquage des secrets (sanitizer)
- **LIVE** : scanne l'écran en continu (OCR + motifs), masque les secrets détectés en temps réel, visible aussi par ton audience pendant un partage.
- **Manuel (Floute)** : tu glisses un rectangle sur n'importe quoi, masquage instantané et 100 % fiable.
- **Manuel (coller)** : colle un texte, il te dit s'il contient un secret avant que tu le partages.

### Enregistrement
- Source : écran entier, fenêtre, ou onglet.
- Audio système + micro.
- Webcam en incrustation (position, forme, taille, effet verre).
- Fond personnalisé ou flou d'arrière-plan webcam (segmentation).
- Export MP4 / WebM.

### Fenêtre Miroir (pour Meet / Zoom / Teams)
- Une page qui affiche un flux live de ton écran **avec les annotations déjà incrustées**, à partager dans Meet en mode « une fenêtre ». Voir [pourquoi plus bas](#3-la-fenêtre-miroir--contourner-le-partage-donglet).

### Mises à jour intégrées
- Paramètres → « Vérifier les mises à jour » compare ta version à la dernière publiée, télécharge et lance l'installeur.

---

## Comment ça marche vraiment (la partie pédagogique)

Cette section explique les choix techniques, **ce qu'on a essayé, ce qui marche, ce qui ne marche pas**. C'est le cœur du projet.

### 1. La barre d'outils qui flotte par-dessus tout

L'app ouvre plusieurs fenêtres Electron : la fenêtre principale (cadrée), la **toolbar** (sans cadre, transparente, toujours au-dessus) et un **overlay** plein écran transparent par moniteur.

L'overlay est en « clic-traversant » par défaut (`setIgnoreMouseEvents(true)`) : tes clics passent à travers vers l'app en dessous. Dès que tu choisis un outil de dessin, on désactive le clic-traversant pour capturer le pointeur, puis on le réactive quand tu reviens en mode sélection.

**Ce qui a été galère :** sur Windows, deux fenêtres « always-on-top » au même niveau se réordonnent selon la dernière activité. L'overlay grimpait parfois au-dessus de la toolbar et masquait ses boutons. Solution : remettre la toolbar au sommet après chaque changement d'interactivité.

### 2. Le masquage des secrets en direct (le plus dur)

**Le principe.** Toutes les ~250 ms : on capture une image de l'écran, on la passe à un moteur OCR (Tesseract) qui lit le texte, puis des expressions régulières + des heuristiques repèrent les secrets, et on pose un masque opaque dessus aux bonnes coordonnées.

**Pourquoi c'est lent.** L'OCR d'une image plein écran prend ~500 ms, parfois plus. C'est le goulot d'étranglement incompressible de cette approche. On a empilé plusieurs optimisations :
- **Saut sur image stable** : avant chaque OCR, on calcule une empreinte d'image minuscule (vignette 16×9, luminance). Si l'écran n'a pas bougé, on saute complètement l'OCR. En usage réel, ça évite la grande majorité des scans.
- **Pool collant (hysteresis)** : un masque détecté reste affiché 15 s même si un scan suivant le rate, pour éviter le clignotement (l'OCR est non déterministe d'une frame à l'autre).
- **Stripe horizontale** : le masque s'étend jusqu'au bord de l'écran, pour que la moindre dérive de l'OCR ne le décale pas hors du secret.
- **JPEG plutôt que PNG** + **mode texte épars** de Tesseract : quelques dizaines de ms gagnées par scan.
- **Pré-traitement contraste/niveaux de gris** : les interfaces sombres (texte gris sur fond gris) sont dures à lire pour l'OCR ; on force un quasi noir-sur-blanc avant lecture.
- **Détecteur d'entropie générique** : toute chaîne longue, aléatoire, mélangeant lettres et chiffres est masquée même sans préfixe connu. Ça attrape une clé « qui ressemble à une clé » sur un site random.

**Ce qui ne marche pas (encore).** Même optimisé, ça reste de l'OCR : ~0,5 à 1 s de latence entre l'apparition d'un secret et son masquage. Pour un vrai « instantané » il faudrait lire le texte directement via les **API d'accessibilité Windows (UI Automation)** au lieu de relire des pixels. C'est précis et rapide (~50 ms) mais ça demande un module natif Windows. C'est le chantier prévu pour la v0.6.

**La leçon perf la plus utile :** on appliquait un `backdrop-filter: blur` sur les masques. Sur une fenêtre transparente, ce flou n'a rien à flouter (rien d'opaque dessous) : c'était donc un coût GPU pur pour zéro effet, qui forçait un repaint complet à chaque scan et **gelait l'interface**. Retiré = plus de freeze. Morale : un effet visuel inutile peut coûter très cher.

**En attendant l'instantané :** l'outil **Floute manuel** existe justement pour ça. Tu glisses un rectangle, c'est instantané et fiable à 100 %, indépendant de l'OCR.

### 3. La fenêtre Miroir : contourner le partage d'onglet

Quand tu partages **un onglet** ou **une fenêtre** dans Google Meet (ou Zoom, Teams), le système ne capture que les pixels de cet onglet/fenêtre précis. Notre toolbar et notre overlay vivent dans **leurs propres fenêtres** : ils sont filtrés hors de la capture. Tu vois tes annotations chez toi, mais ton audience ne voit rien. C'est une limite de Chromium/WebRTC, pas un bug.

**La parade.** Windows (via DWM) compose le bureau **avec** notre overlay transparent **avant** que n'importe quelle API de capture ne lise les pixels. Donc une capture d'écran contient déjà les annotations. La fenêtre Miroir affiche cette capture, et tu partages **cette fenêtre** dans Meet. Ton audience voit le résultat composité.

**Le compromis.** ~100 à 150 ms de latence en plus (capture → miroir → re-capture par Meet). En partage « écran entier », tu n'en as pas besoin : les annotations passent directement. La fenêtre Miroir ne sert qu'aux modes onglet/fenêtre.

Pourquoi pas une vraie « caméra virtuelle » qui apparaîtrait dans le sélecteur de Meet ? Parce que ça demande un pilote Windows signé (certificat coûteux) et une installation administrateur. La fenêtre Miroir couvre l'essentiel sans rien de tout ça.

### 4. Échap et triple-Alt : les raccourcis globaux

Certains raccourcis doivent marcher même quand l'app n'a pas le focus. Le mécanisme standard d'Electron (`globalShortcut`) ne sait pas écouter une touche seule tapée plusieurs fois (triple-Alt), et il **échoue silencieusement** sur Échap quand une autre app possède déjà ce raccourci (ce qui est quasi tout le temps le cas). 

On écoute donc le clavier au niveau bas (uiohook) pour ces deux cas : on voit la touche **sans la consommer** (l'app au premier plan reçoit quand même son Échap). Triple-Alt active le curseur en évidence ; Échap repasse en mode sélection.

### 5. Smart App Control et SmartScreen : pourquoi Windows bloque

Le binaire n'est pas signé avec un certificat éditeur (ça coûte cher pour un projet open source sans budget). Conséquences sur Windows récent :
- **SmartScreen** affiche « Windows protected your PC » → *More info* → *Run anyway*. Bénin.
- **Smart App Control (SAC)** est plus strict : il évalue la **réputation** du binaire chez Microsoft (combien de machines l'ont déjà lancé sans incident). Chaque nouvelle version repart à zéro de réputation, donc une app qui sort souvent reste perpétuellement « inconnue » et peut être bloquée net (erreur `CreateProcess 4551`).

**Solutions** (dans l'app, un bandeau t'aide à débloquer) :
- Clic droit sur le Setup téléchargé → Propriétés → cocher « Débloquer ».
- Ou télécharger depuis la page Releases via le navigateur (la marque « provenance web » aide parfois).
- Ou désactiver SAC (irréversible sans réinstaller Windows).
- Ou lancer depuis les sources (`npm run dev`), l'Electron de dev étant signé.

---

## Installation

### Méthode recommandée — Setup.exe depuis les Releases

👉 **[Télécharger la dernière version](https://github.com/RoYaL63/presentotter/releases/latest)**

1. Récupère `PresentOtter-Setup-x.y.z.exe` dans la section *Assets* de la release.
2. Double-clic. Si SmartScreen prévient : *More info* → *Run anyway*.
3. L'installeur Inno Setup s'ouvre. Install par utilisateur dans `%LOCALAPPDATA%\Programs\PresentOtter\` (pas d'admin requis).
4. Garde *« Lancer PresentOtter »* coché à la fin.

**Mise à jour** : Paramètres → « Vérifier les mises à jour », ou télécharge le nouveau Setup. L'AppId est stable, donc Windows reconnaît une mise à jour et non une nouvelle install.

**Si Smart App Control bloque** : voir [la section dédiée](#5-smart-app-control-et-smartscreen--pourquoi-windows-bloque).

### Build depuis les sources

Prérequis : Node.js 20+, Windows 10/11.

```bash
git clone https://github.com/RoYaL63/presentotter
cd presentotter
npm install
npm run dev              # dev avec hot reload (Electron signé, OK avec SAC)
```

Régénérer l'installeur localement :

```bash
npm run installer:win   # produit release/PresentOtter-Setup-<version>.exe
```

---

## Raccourcis clavier

| Action | Raccourci |
|---|---|
| Sélection / passe-through | Alt+S |
| Crayon | Alt+P |
| Surligneur éphémère | Alt+E |
| Rectangle | Alt+R |
| Cercle | Alt+O |
| Flèche | Alt+A |
| Texte | Alt+T |
| Spotlight | Alt+L |
| Floute une zone (manuel) | Alt+F |
| Undo dernier trait | Alt+Z |
| Tout effacer | Alt+Shift+C |
| Masquer / montrer overlays | Alt+H |
| Masquer / montrer toolbar | Alt+B |
| Quitter l'outil (retour passe-through) | Échap |
| **Curseur en évidence (global)** | **Triple-tap Alt** |

---

## Historique des versions

Le projet a beaucoup itéré en public. Grandes étapes :

| Version | Apport principal |
|---|---|
| **v0.1** | Première alpha : capture + sanitizer + export de base, packagée en .exe. |
| **v0.2** | Annotations complètes, bibliothèque, pipeline de release. |
| **v0.3** | Webcam en incrustation, fond personnalisé, segmentation d'arrière-plan (MediaPipe). |
| **v0.4** | Sanitizer contextuel (détection par libellé), spotlight qui suit le curseur, aide raccourcis, design « otter-morphism ». |
| **v0.5.0** | Spotlight + outil texte fiabilisés, capsule arrondie, mise en avant d'Échap. |
| **v0.5.2–0.5.4** | Anti-clignotement des masques (pool collant), stripe horizontale, détection plus rapide. |
| **v0.5.3** | Mise à jour intégrée depuis l'app (GitHub Releases), versioning harmonisé. |
| **v0.5.5** | Fenêtre Miroir pour les partages d'onglet/fenêtre dans Meet. |
| **v0.5.6–0.5.7** | Nettoyage visuel de la toolbar (menu fantôme, bandeau qui dépassait). |
| **v0.5.8** | Toolbar compacte (popover couleur), Miroir intégré dans l'app. |
| **v0.5.9–0.5.13** | Sanitizer plus rapide (saut sur image stable, OCR épars, JPEG, pré-traitement contraste), plus de formats de clés reconnus, lecture améliorée sur interfaces sombres. |
| **v0.5.11** | Spotlight couvre tout l'écran, bulle minimisée déplaçable. |
| **v0.5.14–0.5.16** | Toolbar verticale (dock latéral), Échap fiabilisé, fenêtre toujours à l'écran, déplaçable depuis tout bord. |
| **v0.5.17–0.5.18** | Surligneur éphémère (fondu progressif, durée réglable), palette de couleurs étendue. |
| **v0.5.19** | Aide au déblocage quand Smart App Control refuse l'installeur. |
| **v0.5.20** | Outil Floute manuel, correction du gel pendant le scan, détecteur d'entropie générique. |
| **v0.5.21** | Échap nettoie l'état actif (plus de croix résiduelle). |
| **v0.6.0** | Début de la refonte design OtterMorphisme (accent menthe), fondations posées. |

Détail complet par version dans la [page Releases](https://github.com/RoYaL63/presentotter/releases).

---

## Ce qui arrive (roadmap)

- **Sanitizer automatique instantané** : lecture du texte via les API d'accessibilité Windows (UI Automation) au lieu de l'OCR, pour passer de ~0,5 s à ~50 ms et une fiabilité bien supérieure.
- **Refonte design OtterMorphisme** : les pages de l'app adoptent un design clair claymorphisme + verre liquide, mode jour/nuit, accent menthe. La toolbar flottante garde sa structure lisible et change juste sa couleur d'action.
- **Stabilisation v1.0**.

---

## Stack technique

| Composant | Technologie |
|---|---|
| App | Electron 29 + React 18 |
| Langage | TypeScript strict |
| UI | Tailwind CSS + design system maison |
| State | Zustand (persisté en local) |
| Capture | `desktopCapturer` + `getUserMedia` (Electron) |
| Enregistrement | MediaRecorder + canvas de composition |
| Segmentation webcam | MediaPipe Tasks Vision |
| OCR | Tesseract.js 5 |
| Raccourcis globaux | uiohook-napi |
| Packaging | @electron/packager + Inno Setup |

---

## Sécurité & vie privée

- Tout est local : aucune donnée, aucune image d'écran, aucun secret détecté ne quitte ta machine.
- Le sanitizer LIVE traite les images en mémoire et ne les stocke pas.
- Le dépôt ne contient aucun identifiant : seul du texte de test factice sert aux tests de détection.

Détails et bonnes pratiques dans [SECURITY.md](SECURITY.md).

---

## Contribuer

Les contributions sont bienvenues. Lis [CONTRIBUTING.md](CONTRIBUTING.md) pour démarrer.

## Licence

MIT — voir [LICENSE](LICENSE).

Fait avec 🦦 par OTTERWISE Solutions.
