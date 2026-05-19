# Premier lancement sur Windows

## SmartScreen bloque l'app — c'est normal

Au tout premier lancement de `PresentOtter.exe`, Windows affiche :

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.
> [More info] [Don't run]

PresentOtter n'est pas (encore) signé avec un certificat code-signing
commercial. Pour Microsoft, ça veut dire « réputation = inconnue », donc
SmartScreen joue prudent et propose de ne pas lancer.

**Ce n'est pas un virus, juste un .exe sans signature.** Pour autoriser
le lancement la première fois :

1. Clique sur **More info** (Plus d'infos) dans la pop-up.
2. Un bouton **Run anyway** (Exécuter quand même) apparaît.
3. Clique-le. Windows mémorise ton choix et ne te re-demandera plus
   pour ce binaire-là.

À partir du deuxième lancement, le raccourci sur le bureau démarre
directement, sans demander.

## Pourquoi le premier lancement est lent (30 s à 1 min)

Microsoft Defender (et la plupart des antivirus tiers) scannent en
profondeur tout `.exe` inconnu la première fois qu'il s'exécute. Sur un
bundle Electron de 230 MB, le scan peut prendre **30 à 60 secondes** —
puis le résultat est mis en cache et les démarrages suivants sont
quasi-instantanés (1-3 s).

Tu peux accélérer le premier scan en désactivant le « real-time scan »
le temps du test (Settings → Privacy & Security → Windows Security →
Virus & threat protection → Manage settings), mais ne le laisse pas
désactivé.

## Plus jamais ce problème

Deux options pour de vrai :

- **Acheter un certificat code-signing EV** (~300 €/an). PresentOtter
  est immédiatement reconnu par SmartScreen, plus de blocage, plus de
  scan profond. C'est la route officielle.
- **Construire de la réputation Microsoft** : un certif simple (~80 €/an)
  + soumettre le binaire à Microsoft une fois qu'il a été téléchargé
  par plusieurs centaines de personnes. Gratuit en cumul mais long.

Pour v0.1.x-alpha on accepte le « Run anyway » la première fois. Le
README du projet documentera la procédure côté utilisateur quand on
ouvrira les téléchargements publics.

## Si le lancement est *toujours* lent après le premier

Possibles causes :

1. **Disque dur HDD** plutôt que SSD : 230 MB à charger en mémoire,
   c'est plus long. Solution : déplacer `PresentOtter-win32-x64/` sur
   un SSD si tu en as un.
2. **Antivirus tiers** (Kaspersky, Norton, McAfee…) qui re-scanne à
   chaque exécution. Ajoute le dossier `release/PresentOtter-win32-x64`
   en exclusion.
3. **OneDrive sync** : si le `.exe` est dans un dossier OneDrive
   synchronisé, OneDrive peut bloquer l'accès pendant qu'il vérifie
   l'intégrité. Déplace le dossier hors OneDrive.
4. **Multiples instances** : si tu cliques deux fois rapidement sur le
   raccourci, deux processus se lancent. Vérifie dans le Gestionnaire
   des tâches qu'il n'y a qu'un `PresentOtter.exe` en cours.

## Désinstaller

Pas d'installeur en v0.1.x-alpha donc rien à désinstaller :

1. Supprime le dossier `release/PresentOtter-win32-x64/`.
2. Supprime le raccourci du bureau.
3. (Optionnel) Supprime `%APPDATA%/PresentOtter/` qui contient le cache
   Chromium et le localStorage des paramètres outils.
