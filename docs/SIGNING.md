# Signer le .exe Windows

PresentOtter v0.1.x-alpha ne ship pas signé. Smart App Control (Windows 11
22H2+) bloque purement le binaire, et SmartScreen (Windows 10/11 sans SAC)
demande un « Run anyway ». Quand tu acquerras un certificat code-signing,
le script `pack:win` est prêt à l'utiliser sans modification du code.

## Quelle option pour quel besoin

| Option | Coût | Délai | SAC passe ? | SmartScreen passe ? | Recommandé pour |
|---|---|---|---|---|---|
| **Microsoft Store (MSIX)** | $19 unique | 1-7 j validation | ✅ Direct | ✅ Direct | Distribution grand public, indé |
| **Azure Trusted Signing** | ~$10/mois | 1-3 j | ✅ Direct (signature) | ✅ Direct | CI/CD, structure 3+ ans |
| **Cert EV code-signing** | $300-500/an | 5-10 j | ✅ Direct (signature) | ✅ Direct (réputation immédiate) | Distribution hors-Store |
| **Cert OV code-signing** | $80-200/an | 1-3 j | ⚠️ Après quelques mois | ⚠️ "Unrecognized" au début | Pas suffisant seul |
| **Self-signed** | gratuit | 0 j | ❌ Bloqué | ❌ Bloqué | Tests internes uniquement |

**Ma recommandation pour PresentOtter** : Microsoft Store en MVP grand
public, ou cert EV si tu veux héberger les téléchargements toi-même
(GitHub Releases, site OTTERWISE).

## Vendeurs de cert EV (par ordre de prix)

- **SSL.com EV CodeSigning** — ~$249/an, accepte HSM cloud (pas de token
  USB requis)
- **Sectigo EV CodeSigning** — ~$329/an, token USB ou cloud
- **DigiCert EV CodeSigning** — ~$474/an, plus cher mais bien intégré
- **GlobalSign EV CodeSigning** — ~$430/an

Pour tous, **prévoir 5-10 jours** de validation business (KYC,
appel téléphone, parfois justificatifs).

## Une fois que tu as le cert

Le script `scripts/package-win.js` détecte automatiquement le signing si
tu fournis l'une de ces combinaisons de variables d'environnement.

### Cas A — Cert sur fichier PFX (cert OV ou EV avec HSM cloud)

```powershell
# PowerShell — Cert dans un fichier .pfx avec password
$env:CSC_LINK = "C:\path\to\presentotter-cert.pfx"
$env:CSC_KEY_PASSWORD = "your-pfx-password"
npm run pack:win
```

Le script :
1. Bundle l'app normalement
2. Trouve `signtool.exe` (PATH puis fallback sur les paths standards du
   Windows SDK)
3. Appelle `signtool sign /fd SHA256 /tr <timestamp> /td SHA256 /f cert.pfx
   /p <pwd> PresentOtter.exe`
4. Vérifie le code retour

### Cas B — Cert dans le Windows Cert Store (cert EV avec token USB)

Avec un cert EV livré sur token USB ou via HSM avec driver Windows, le
cert est installé dans le Windows Certificate Store sous ton compte
utilisateur. Tu signes en référençant son sujet :

```powershell
$env:WIN_SIGN_CERT_SUBJECT = "OTTERWISE Solutions"
npm run pack:win
```

Au signing, Windows te demandera **interactivement** le code PIN du token
si applicable.

### Customiser le timestamp server

Par défaut, on utilise `http://timestamp.digicert.com`. Pour overrider :

```powershell
$env:WIN_SIGN_TIMESTAMP_URL = "http://timestamp.sectigo.com"
```

Le timestamp est important : sans lui, ta signature expire en même temps
que le cert. Avec, elle reste valide à jamais.

## Vérifier qu'une signature est OK

```powershell
# Affiche le cert + le statut de la chaîne de confiance
& "C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe" verify /pa /v "release\PresentOtter-win32-x64\PresentOtter.exe"
```

Réponses possibles :
- `Successfully verified` + chaîne ⇒ signature OK, devrait passer SmartScreen
- `SignTool Error: No signature found` ⇒ pas signée
- `SignTool Error: A certificate chain processed, but terminated in a root certificate which is not trusted` ⇒ cert self-signed ou CA non trusted

## Réputation Microsoft (cert OV uniquement)

Pour les cert OV (non-EV), même signée l'app a réputation = 0 chez
Microsoft → SmartScreen montre toujours "Unrecognized" pour les
premiers utilisateurs. La réputation se construit :

1. **Naturellement** : 1000+ téléchargements + lancements OK → la
   réputation monte
2. **Soumission directe** :
   https://www.microsoft.com/wdsi/filesubmission → "Software developer"
   → upload l'.exe signé → demander review

EV n'a pas ce problème — réputation Microsoft immédiate à partir d'une
seule signature.

## Microsoft Store : un autre chemin

Si tu vises le Store, le packaging est différent : MSIX au lieu de
.exe brut. `electron-builder` sait produire du MSIX :

```yml
# electron-builder.yml — exemple, pas encore en place dans PresentOtter
win:
  target:
    - target: msix
      arch: [x64]
appx:
  identityName: OTTERWISE.PresentOtter
  publisher: CN=<your Microsoft Store publisher ID>
  publisherDisplayName: OTTERWISE Solutions
```

Microsoft signe le MSIX au moment de la publication → tu pousses un
binaire non signé, ils le signent eux-mêmes. C'est plus simple que de
gérer un cert.

## Plan de migration recommandé

1. **Aujourd'hui** : ship unsigned. Utilisateurs sur Win11 SAC ON ne
   peuvent pas lancer → expliquer dans le README.
2. **Phase 1** : créer compte Microsoft Store ($19), publier en MSIX.
   Distribution principale via le Store. Téléchargement direct sur
   GitHub Releases reste possible mais flag SmartScreen.
3. **Phase 2** : si volume justifie (1000+ users/mois en téléchargement
   direct), prendre un cert EV. SmartScreen + SAC passent immédiatement
   sur tous les téléchargements directs.

Pour PresentOtter v0.1.x-alpha, **on accepte que SAC bloque** parce
qu'on cible des early users qui peuvent désactiver SAC ou tester sur
une autre machine. La signature arrive en v0.2.
