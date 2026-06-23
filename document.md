# Refonte design PresentOtter → OtterMorphisme

Plan de migration du design actuel vers le design system OtterMorphisme (menthe, claymorphisme + verre liquide, jour/nuit). Document de travail, pas de code ici, seulement les décisions et l'ordre d'exécution.

Référence design : `GUIDE-COMPLET (1).md` (collé par l'utilisateur).

---

## 1. Où on en est aujourd'hui

Le design actuel s'appelle déjà "otter-morphism" en interne mais il ne correspond PAS au nouveau guide. Différences de fond :

| Axe | Actuel | Cible OtterMorphisme |
|---|---|---|
| Accent | Corail `#FF8B7B` | Menthe `#0FA587 / #2BD9AC` (accent unique) |
| Base | Bleu-mer + crème + corail (multi-couleurs) | Fond frais vert pâle + encre + menthe (60/30/10) |
| Surfaces | Verre sombre (toolbar/overlay) + verre clair (Home) | Pâte (clay) claire + verre liquide translucide |
| Modes | Un seul (la Home claire, la toolbar sombre) | Deux modes complets jour / nuit |
| Polices | Inter / Outfit / JetBrains Mono | Special Elite (display) / Syne (corps) / JetBrains Mono (méta) |
| Mascotte | Loutre présente partout | Pas d'emoji déco ; loutre à repenser ou retirer des chromes |
| Emphase titre | Couleur corail sur le mot | Soulignement rivière menthe animé (jamais de couleur) |
| Navigation | Onglets statiques (TopNav Home) | Capsule sticky + goutte de navigation qui glisse |

Verdict : c'est une refonte de tokens + composants, pas un reskin léger. On garde l'archi (fenêtres, IPC, outils), on remplace la couche visuelle.

---

## 2. La contrainte critique à régler d'abord

Le guide OtterMorphisme est pensé pour une **page web normale** : fond frais maîtrisé, verre liquide qui laisse voir "la rivière" derrière. Or PresentOtter a deux familles de surfaces qui n'ont pas de fond maîtrisé :

- **Toolbar** (fenêtre flottante transparente, par-dessus n'importe quel écran)
- **Overlay** (plein écran transparent, par-dessus n'importe quel bureau)

Le verre liquide translucide qui "montre la rivière" n'a aucun sens ici : derrière, c'est le bureau aléatoire de l'utilisateur. Un `backdrop-filter: blur` y est soit illisible, soit inutile (déjà constaté avec les masques sanitizer en v0.5.20).

**Décision (validée par l'utilisateur) :** deux niveaux d'application.

1. **Surfaces cadrées** (Home, Paramètres, Outils, Bibliothèque, Miroir, popups) → reprennent **intégralement le design web envoyé** : pâte claire, verre liquide, jour/nuit, goutte de navigation, soulignement rivière, polices. Fond frais maîtrisé.
2. **Chromes flottants** (Toolbar, Overlay) → **on ne touche PAS à la structure** (elle reste lisible par-dessus n'importe quel bureau). On change **uniquement la couleur d'action** : corail → menthe. Pas de verre translucide qui dépend du fond, pas de refonte de layout.

Citation utilisateur : « il faut que ça reste lisible. […] la page logicielle qui doit reprendre le design web envoyé et […] la toolbar qui flotte par-dessus le bureau, il faut que ça reste comme ça. On change juste la couleur d'action dessus. »

---

## 3. Nouveaux tokens (tailwind.config.js)

Remplacer la palette actuelle. On garde des alias temporaires le temps de migrer les composants, puis on supprime.

### Couleurs jour
```
mint        : 50 #E8FBF5 · 100 #C9F4E8 · 300 #5FE3C0 · 400 #2BD9AC · 500 #19C49E · 600 #0FA587 · 700 #0B806A
ink         : #15201C            (texte principal)
ink-soft    : rgba(21,32,28,.55) (texte secondaire)
fresh       : #E7F0EC            (fond page, dégradé radial vers #EFF6F2)
clay        : #FCFEFD → #E6EFEB  (dégradé 145° des surfaces pâte)
on-mint     : #06231C            (texte sur fond menthe)
```

### Couleurs nuit
```
fresh-d   : #0A1F1B → #143029
clay-d    : #183C32 → #0F2922
ink-d     : #E7F3ED
mint-d    : #3BE6C0 (liserés menthe, ombres noires)
```

### Ombres (cœur du claymorphisme)
À porter en `boxShadow` Tailwind, valeurs exactes du guide §4 :
- `clay` (carte / surface pâte) — lumière haut-gauche, ombre froide bas-droite, 2 liserés internes.
- `clay-btn` (bouton / petite surface).
- `inset` (champ, rail, piste de toggle).
- `glass` + `glass-blur` (verre liquide, réservé aux surfaces cadrées).

Règle absolue : lumière toujours haut-gauche, ombre toujours bas-droite. Dark mode : ombre froide → noire, liseré interne → menthe.

### Rayons
cartes `26px` · champs `16px` · badges/pilules `50px` · petites surfaces `13-18px`.

### Polices (à charger)
- **Special Elite** (Google Fonts) → `font-display`, titres héros + valeurs clés uniquement.
- **Syne** (Google Fonts) → `font-sans`, 700 titres, 400 corps.
- **JetBrains Mono** → `font-mono`, méta/labels en MAJUSCULES, 8-10px, letter-spacing 0.1-0.28em.

Electron est offline-first → bundler les .woff2 en local (`src/renderer/public/fonts/`), pas de CDN Google.

---

## 4. Inventaire des surfaces à migrer

| Fichier | Type | Effort | Notes |
|---|---|---|---|
| `index.css` | tokens + classes utilitaires | gros | refondre `glass`, `otter-clay`, `otter-mesh`, ajouter clay/inset/verre menthe, jour/nuit via `[data-theme]` |
| `tailwind.config.js` | tokens | moyen | palette menthe, ombres, polices, keyframes rivière |
| `Home.tsx` | surface cadrée | gros | navbar capsule + goutte, cartes pâte, soulignement rivière sur le titre |
| `pages/Settings.tsx` | surface cadrée | moyen | cartes pâte, toggle jour/nuit, bandeau version |
| `pages/Tools.tsx` | surface cadrée | moyen | cartes pâte, sliders en creux, sélecteurs |
| `pages/Library.tsx` | surface cadrée | moyen | cartes pâte, états vides |
| `Mirror.tsx` | surface cadrée | léger | header pâte, garder la vidéo sur fond sombre |
| `SanitizerPopup.tsx` | modale | moyen | modale pâte + en-tête vague rivière |
| `RecordingPanel.tsx` | modale | gros | grosse surface, beaucoup de contrôles |
| `ShortcutsHelp.tsx` | modale | léger | liste pâte |
| `Toolbar.tsx` | chrome flottant | gros | capsule pâte flottante opaque, accent menthe, jour/nuit propre |
| `Overlay.tsx` | chrome flottant | moyen | masques sanitizer + couleurs d'annotation en menthe par défaut ; spotlight/curseur halos menthe |
| `components/Mascot.tsx` | asset | décision | garder la loutre comme logo app, la retirer des chromes (guide : pas d'emoji déco) |

---

## 5. Décisions ouvertes (à trancher avant de coder)

1. **Mode par défaut** : jour ou nuit au premier lancement ? Proposition : jour (le guide est jour-first), avec bascule persistée.
2. **Toggle jour/nuit** : où le poser ? Dans la navbar Home (comme le guide). La toolbar flottante suit le même réglage via le store partagé.
3. **Mascotte** : le guide dit "pas d'emoji déco". On garde la loutre comme **logo de marque** (Home hero + icône app + bulle minimisée) mais on la retire des micro-emplacements (boutons, toasts). À confirmer.
4. **Accent annotation** : aujourd'hui le corail est la couleur de trait par défaut. En OtterMorphisme l'accent est menthe. On bascule les défauts d'outils sur menthe ? La palette de couleurs de dessin (14 teintes) reste, elle, multicolore (besoin fonctionnel d'annoter en rouge/etc.). Seul le défaut + les chromes passent menthe.
5. **Special Elite partout ?** Non. Réservée aux titres héros et grands nombres (numéro de version, compteurs). Sinon illisible en petit.
6. **Couleur des masques sanitizer** : aujourd'hui deep-sea + corail. Passer en encre + liseré menthe pour cohérence, en gardant l'opacité totale (sécurité).

---

## 6. Plan d'exécution par phases

Chaque phase = une version publiable, testée, qui ne casse rien. On ne big-bang pas la refonte.

### Phase A — Fondations (v0.6.0)
- Charger les 3 polices en local.
- Réécrire `tailwind.config.js` : palette menthe, ombres clay/inset/verre, rayons, keyframes rivière.
- Ajouter le switch de thème `[data-theme="day|night"]` sur `<html>` + store persistant + IPC de sync entre fenêtres (le mécanisme `storage` event existe déjà).
- Aucun composant retouché visuellement encore : juste les tokens en place + alias de compat. But : rien ne doit casser.

### Phase B — Surfaces cadrées (v0.6.1)
- Home : navbar capsule sticky + goutte de navigation + cartes pâte + soulignement rivière sur "PresentOtter".
- Settings, Tools, Library, Mirror : cartes pâte, champs en creux, sliders en creux.
- Toggle jour/nuit câblé dans la navbar.

### Phase C — Modales (v0.6.2)
- SanitizerPopup, RecordingPanel, ShortcutsHelp : surfaces pâte + en-tête vague rivière + actions menthe/neutre.

### Phase D — Chromes flottants (v0.6.3)
- Toolbar : capsule pâte flottante opaque, accent menthe, suit le thème, garde le mode vertical + drag.
- Overlay : défauts d'annotation menthe, masques sanitizer en encre/menthe, halos spotlight/curseur menthe.
- Retrait des alias de compat couleurs, nettoyage `index.css`.

### Phase E — Finitions (v0.6.4)
- Animations rivière discrètes (bulles, caustiques) sur les fonds cadrés uniquement.
- Passe d'accessibilité (contrastes jour ET nuit).
- Checklist §16 du guide validée point par point.

---

## 7. Risques

- **Lisibilité toolbar/overlay** : déjà traité §2, mais à re-tester sur fonds clairs ET sombres à chaque phase D.
- **Perf des animations** : les vagues/bulles SVG sont légères, mais à bannir des chromes flottants (coût compositeur sur fenêtre transparente, cf. le freeze backdrop-filter de v0.5.20). Animations rivière = surfaces cadrées seulement.
- **Special Elite en petit** : illisible sous ~20px. Discipline stricte sur son usage.
- **Régression fonctionnelle** : la refonte ne touche que le visuel. Les 192 tests doivent rester verts à chaque phase. Aucun changement d'IPC ou de logique d'outil.

---

## 8. Hors-scope de la refonte (suivi séparé)

### Sanitizer automatique v0.6 (demande utilisateur)
Le sanitizer manuel (outil Floute) est conservé. En parallèle de la refonte, créer une détection automatique plus rapide et fiable que l'OCR Tesseract actuel. Piste principale : **API d'accessibilité natives Windows (UI Automation)** pour lire le texte exact des contrôles sans OCR (~50ms, fiabilité ~100% sur apps natives + Chromium + Electron). Chantier à part : module natif ou helper, bundling Windows. Ne dépend pas de la refonte design. Tâche dédiée créée.

---

## 9. Ce qui est déjà fait

- **v0.5.21** — Bug Échap corrigé : `select` ne s'affiche plus comme actif et ne montre plus l'icône X. Retour propre à l'état "rien de sélectionné" sur Échap.
- **v0.6.0** — Fondations menthe : palette `mint` + `glow-mint` dans Tailwind (additif, aucun token cassé). Toolbar passée en accent menthe (outils actifs, bouton LIVE, badge, slider curseur, pastille de statut) — structure inchangée, lisibilité préservée. C'est la partie "toolbar = juste la couleur d'action" du scope.
- **v0.6.1** — Phase B (surfaces cadrées). Tout est scopé `html[data-mode='home']`, toolbar/overlay zéro changement :
  - Polices OtterMorphisme bundlées en local (offline) : Special Elite (titres display), Syne (corps), JetBrains Mono (méta). Fichiers dans `src/renderer/fonts/`, fingerprintés par Vite.
  - Fond frais menthe (mesh reteinté), surfaces pâte claires (`#FCFEFD→#E6EFEB`), verre liquide à liseré menthe.
  - Accent unique menthe : CTA, dégradés, anneaux, focus, remaps corail→menthe sur toutes les pages cadrées (Accueil, Outils, Bibliothèque, Paramètres, Miroir).
  - Soulignement rivière sur le mot "Otter" du wordmark (plus de couleur de texte).

## Reste à faire (Phase B+ / C / D / E)

- **Goutte de navigation** animée (glisse entre onglets) — pour l'instant l'onglet actif = anneau menthe simple.
- **Mode jour/nuit** complet + toggle dans la navbar (les tokens nuit sont définis dans ce doc, pas encore câblés ; pour l'instant jour uniquement).
- **Modales** (SanitizerPopup, RecordingPanel, ShortcutsHelp) : en-tête vague rivière, surfaces pâte dédiées.
- **Finitions** : bulles/caustiques discrètes sur les fonds cadrés, passe d'accessibilité.

Décisions §5 encore ouvertes : sort exact de la mascotte (gardée pour l'instant comme logo), activation du mode nuit.

---

*OtterMorphisme · Otterwise Solutions — plan de migration PresentOtter.*
