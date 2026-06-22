# Microsoft Defender Security Intelligence — guide de soumission

But : faire whitelister PresentOtter par Microsoft pour qu'il passe SAC + SmartScreen sur **tous** les Windows du monde, sans signature payante.

URL : <https://www.microsoft.com/en-us/wdsi/filesubmission>

Délai constaté : **1 à 7 jours** (review humain). Une fois validé, le hash est ajouté à l'**Intelligent Security Graph** et le binaire passe partout.

---

## Étapes (5 minutes)

1. Connecte-toi avec ton compte Microsoft (créé pour l'occasion si tu n'en as pas, gratuit).
2. **Customer Type** → `Software developer`.
3. Upload **les deux fichiers** (cf. section suivante) en deux soumissions séparées. La première débloque l'installeur, la seconde le binaire qu'il déploie.
4. **Detection name** → laisse vide (le scanner n'a rien détecté à l'avance, c'est une *pre-emptive submission*).
5. **Category** → `Incorrectly detected as malware/malicious` (oui même si rien n'est explicitement détecté ; c'est la catégorie utilisée pour les false-positives anticipés).
6. **Definition version** → ce qu'on te propose par défaut.
7. **Additional information** → copie-colle le bloc *Description* ci-dessous.
8. Soumets.

---

## Fichiers à uploader

### 1. Installateur

```
Chemin local : %USERPROFILE%\Documents\Presentotter\release\PresentOtter-Setup-0.1.0.exe
Taille       : 72.89 MB
SHA-256      : F2F4BFA80242E0F5590E56551A3F01D2F280FD4C07D05B55216F9670AF628FDA
```

### 2. Binaire principal (déployé par l'installeur)

```
Chemin local : %USERPROFILE%\Documents\Presentotter\release\PresentOtter-win32-x64\PresentOtter.exe
Taille       : 168.10 MB
SHA-256      : BB15BF77E560633CF764DCFE81DC2DAAF1D9705EF09D8EE92C72271F5052A77F
```

> ⚠️ Si tu rebuild l'app après la soumission, les hash changent et il faut re-soumettre. Évite donc de rebuilder tant que la review n'est pas validée par mail.

---

## Description à copier-coller

```text
PresentOtter — open-source screen annotation overlay for Windows
Publisher  : OTTERWISE Solutions <otterwise-solutions@proton.me>
Source code: https://github.com/RoYaL63/presentotter
License    : MIT
Version    : 0.1.0

What the binary does:
- Creates a floating, transparent overlay window on top of the user's
  desktop for live annotation during screen-share sessions
  (Google Meet, Zoom, Teams, OBS).
- Provides a real-time secret-sanitizer (Tesseract.js OCR + regex
  catalogue) that automatically masks API keys, JWTs, PATs and PII
  shown on the user's screen during a demo.
- Includes a screen recorder backed by Electron's MediaRecorder
  (WebM output, optional MP4 export via the user's local ffmpeg).

Network behaviour:
- No telemetry. No analytics. No remote logging.
- Network access is limited to:
    a) Tesseract.js core + traineddata fetched on first OCR start
       (jsdelivr CDN). Hash-pinned via the npm tesseract.js package.
    b) Optional update check against the public GitHub releases API.

Built with:
- Electron 29 (Chromium runtime)
- React + TypeScript renderer
- @electron/packager (no electron-builder, no custom shellcode)
- Inno Setup 6 (classic installer wrapper)

Reason for submission:
The binary is currently unsigned (open-source v0.1.x alpha — no EV cert
budget yet). Smart App Control + SmartScreen flag every fresh hash as
unknown. This submission is to confirm the file is clean and have its
hash added to the Intelligent Security Graph so users can install it
without "Smart App Control blocked this app".

Audit trail:
- Full source on GitHub (link above).
- All builds reproducible via:
    npm install && npm run installer:win
- Pre-commit secret scanner (scripts/check-secrets.js) blocks
  accidental credential leaks.
```

---

## En attendant la validation

Tu reçois un mail de Microsoft sous 1-7 jours :

- ✅ **« We have determined that this file is not malware. »** → le hash est whitelist. Re-télécharge ton installeur et relance-le ; SAC le laissera passer cette fois.
- ❌ Rejet → Microsoft précise pourquoi (rare pour un binaire électron classique). Tu peux re-soumettre avec plus de contexte.

**Pour continuer à utiliser PresentOtter pendant l'attente**, deux solutions :

### A) Mode dev (rapide)

```powershell
cd %USERPROFILE%\Documents\Presentotter
npm run dev
```

L'électron en mode dev est signé par GitHub → pas bloqué par SAC. Tu gardes un terminal ouvert pendant l'utilisation.

### B) Désactiver SAC (irréversible)

Settings → Privacy & Security → Windows Security → App & browser control → Smart App Control settings → **Off**.

⚠️ Une fois sur `Off`, tu ne peux plus le remettre sur `On` sans réinstaller Windows. Choix définitif.
