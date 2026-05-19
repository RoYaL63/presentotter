# Installer & lancer PresentOtter sur Windows

## Installation

Deux options selon comment tu as récupéré l'app.

### A) Tu as `PresentOtter-Setup-0.1.0.exe` (installateur classique)

1. Double-clic sur `PresentOtter-Setup-0.1.0.exe`.
2. SmartScreen va probablement afficher :
   > **Windows protected your PC** — Microsoft Defender SmartScreen prevented an unrecognized app from starting.
3. Clique **More info** (Plus d'infos) → un bouton **Run anyway** (Exécuter quand même) apparaît.
4. Clique **Run anyway**.
5. L'installateur Inno Setup s'ouvre. Suit le wizard :
   - **Per-user install** par défaut (pas d'UAC, pas d'admin) → l'app s'installe dans `%LOCALAPPDATA%\Programs\PresentOtter\`.
   - Tu peux cocher **Install for all users** si tu veux mettre dans `C:\Program Files\` (demandera l'UAC).
   - Tâches optionnelles : raccourci bureau + entrée menu Démarrer (les deux cochées par défaut).
6. À la fin, garde **Lancer PresentOtter** coché → l'app démarre.
7. Une entrée **PresentOtter** apparait dans Apps & features (Add/Remove Programs) pour désinstaller proprement plus tard.

### B) Tu as le dossier `PresentOtter-win32-x64/` (mode portable)

1. Copie le dossier où tu veux (Documents, Bureau, etc.).
2. Double-clic `PresentOtter.exe` dedans.
3. Pareil que ci-dessus pour SmartScreen → **More info → Run anyway**.

Pour avoir un raccourci sur le bureau en mode portable :
```powershell
$WshShell = New-Object -ComObject WScript.Shell
$lnk = $WshShell.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\PresentOtter.lnk")
$lnk.TargetPath = (Resolve-Path ".\PresentOtter.exe").Path
$lnk.WorkingDirectory = (Resolve-Path ".").Path
$lnk.Save()
```

## Smart App Control (SAC) — cas particulier Win11 22H2+

Si Windows refuse purement et simplement, sans même proposer **Run anyway**, tu es probablement sur Win11 récent avec **Smart App Control en mode ON**. SAC est plus strict que SmartScreen : il bloque tout binaire non signé, sans bouton bypass.

Pour vérifier l'état :
- Settings → Privacy & Security → Windows Security → App & browser control → **Smart App Control settings**
- Statut possible : `On` (bloque), `Evaluation` (apprend pendant 1-3 semaines), `Off` (laisse passer)

**Si SAC est `On`**, deux options gratuites :

1. **Désactiver SAC**. ⚠️ Une fois sur `Off`, on ne peut plus le remettre sur `On` sans réinstaller Windows. Va dans le panneau ci-dessus et clique `Off`. Confirme. Relance l'install.
2. **Soumettre le binaire à Microsoft Defender** pour ajout dans la whitelist Intelligent Security Graph (ISG). C'est gratuit, et ça peut faire passer SmartScreen + SAC pour tous les utilisateurs — détails dans la section suivante.

Si SAC est en `Evaluation`, il devrait basculer sur `Off` tout seul au bout de 1-3 semaines d'utilisation normale. Patience ou bascule manuellement.

## Faire reconnaître PresentOtter par Microsoft (gratuit, pas de signature)

Microsoft accepte des soumissions gratuites de binaires développeurs pour les analyser et ajouter à leur cloud. Si Microsoft Defender confirme que l'app est clean :

- Le hash exact du binaire est whitelisté dans Microsoft Intelligent Security Graph.
- **SmartScreen ne demandera plus "More info"** sur ce hash précis pour personne.
- SAC peut aussi accepter (pas garanti, mais probable).

### Comment soumettre (le développeur, pas l'utilisateur)

1. Va sur https://www.microsoft.com/en-us/wdsi/filesubmission
2. Choisis **Software developer**.
3. Connexion avec un compte Microsoft (gratuit).
4. Upload `PresentOtter-Setup-0.1.0.exe` (le fichier exact que tu vas distribuer).
5. Catégorie : **Incorrectly detected as malware/malicious**.
6. Description : décris l'app (« open-source screen annotation overlay, no network calls, source code at github.com/RoYaL63/presentotter »).
7. Soumets.

Délai : 1 à 7 jours pour review humain. Tu recevras un email avec le verdict. Si "clean" → SmartScreen passe pour ce hash.

⚠️ **Chaque nouveau build = nouveau hash = nouvelle soumission.** Donc on évite de rebuilder pour rien si on veut conserver la reconnaissance.

### Alternative : laisser la réputation se construire naturellement

Microsoft Defender Cloud Protection apprend des données télémétrie de tous les Windows du monde. Si quelques centaines d'utilisateurs cliquent "Run anyway" sur ton binaire sans rien casser, Microsoft remonte automatiquement sa réputation. Ça prend 2-8 semaines en pratique.

Donc même sans soumission active, **plus le binaire est téléchargé et utilisé, moins SmartScreen s'affichera**.

## Premier lancement lent (30 s à 1 minute)

Microsoft Defender et la plupart des AV tiers scannent les `.exe` inconnus en profondeur à la première exécution. Sur un bundle Electron, ça peut prendre 30-60 s avant que la fenêtre s'ouvre.

Les **lancements suivants** sont quasi-instantanés (1-3 s) car le résultat du scan est mis en cache.

Si le premier lancement est plus lent que ça :
- **Disque HDD** → installe sur SSD.
- **Antivirus tiers** (Kaspersky / Norton / McAfee / Bitdefender) → ajoute le dossier d'install en exclusion (Settings de l'AV → Exclusions → ajouter `%LOCALAPPDATA%\Programs\PresentOtter\` ou `C:\Program Files\PresentOtter\`).
- **OneDrive sync** : si tu l'as mis dans un dossier OneDrive → déplace ailleurs. OneDrive bloque l'accès le temps de la vérification d'intégrité.

## Désinstaller

### Si tu as installé via Setup.exe

- Settings → Apps → Installed apps → cherche **PresentOtter** → trois petits points → **Uninstall**
- ou Panneau de configuration → Programmes → cherche **PresentOtter** → Désinstaller
- L'uninstaller efface également `%LOCALAPPDATA%\PresentOtter\` (cache + paramètres)

### Si tu as installé via le dossier portable

- Supprime simplement le dossier `PresentOtter-win32-x64/`
- Supprime le raccourci du bureau
- (Optionnel) Supprime `%LOCALAPPDATA%\PresentOtter\` pour le clean total
