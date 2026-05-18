# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x-alpha | ✅ pre-release, best-effort |
| < 0.1.0 | ❌ |

## Reporting a Vulnerability

**Do not open a public issue for security reports.**

Email otterwise-solutions@proton.me with:
- A description of the vulnerability and its impact
- Steps to reproduce (or a minimal PoC)
- Your environment (Windows version, PresentOtter version)
- Whether you'd like to be credited in the release notes

Expected response time: 72 hours for acknowledgement, 14 days for a fix or
remediation plan on confirmed issues.

## Security Hygiene for Contributors

### Never commit secrets

This repo runs a pre-commit-style scan against staged content:

```bash
npm run check:secrets
```

It blocks GitHub PATs (`ghp_*`), OpenAI keys (`sk-*`), Anthropic keys
(`sk-ant-*`) and AWS access keys (`AKIA*`).

To enable it on every commit (recommended), add to `.git/hooks/pre-commit`:

```sh
#!/usr/bin/env sh
node scripts/check-secrets.js
```

Then `chmod +x .git/hooks/pre-commit` (Linux/Mac) — on Windows, Git for Windows
will execute the hook through `sh.exe` if the file exists.

### Use git credential helper, not tokens in URLs

```bash
git config --global credential.helper manager
```

This stores PATs in Windows Credential Manager (encrypted at rest) instead
of having them appear in shell history, transcripts or remote URLs.

### Provisioning a GitHub PAT (Windows, PowerShell)

**Never paste your live token into a chat (with any AI assistant or anyone
else), a file, a URL, or a script.** Any token that has appeared in those
places should be considered compromised — rotate it immediately at
https://github.com/settings/tokens.

The proper one-time provisioning flow:

1. **Generate the token** on https://github.com/settings/tokens/new
   - Note: descriptive (e.g. `PresentOtter dev — laptop`)
   - Expiration: 30 to 90 days (never "no expiration")
   - Scopes: `repo` (push/pull), `workflow` (only if you'll edit `.github/workflows/`)
   - Click **Generate** and **copy** it to the clipboard. Do not paste it
     anywhere yet.

2. **Store it in Windows Credential Manager** via a single PowerShell
   command. `Read-Host -AsSecureString` keeps the value out of the
   command history; the here-string is piped directly into
   `git credential approve` which writes to the credential manager:

   ```powershell
   $token = Read-Host "Paste your GitHub PAT (input will be hidden)" -AsSecureString
   $plain = [System.Net.NetworkCredential]::new("", $token).Password
   @"
   protocol=https
   host=github.com
   username=YOUR_GITHUB_USERNAME
   password=$plain
   "@ | git credential approve
   $plain = $null
   Remove-Variable token, plain
   ```

   When prompted, paste your token (Ctrl+V) — PowerShell will show nothing,
   that's intentional. Press Enter to confirm.

3. **Verify** by pushing a small change:

   ```bash
   git push
   ```

   No password prompt should appear. If you see `fatal: could not read
   Username for 'https://github.com'`, set the username once:

   ```bash
   git config --global user.name "YOUR_GITHUB_USERNAME"
   git config --global credential.https://github.com.username YOUR_GITHUB_USERNAME
   ```

4. **Remove any token still embedded in a remote URL**:

   ```bash
   git remote set-url origin https://github.com/USER/REPO.git
   ```

### What to do if a token leaks

1. **Revoke first, debug later.** Go to https://github.com/settings/tokens
   and delete the leaked token. GitHub will reject any further use of it
   within seconds.
2. **Audit recent activity** on https://github.com/settings/security-log
   — look for pushes, PRs, or releases you didn't make.
3. **If the leaked token had `repo` scope and was active for a while**,
   assume any private code it could see may have been read. Check for
   unexpected commits on your branches.
4. **Generate a new one** following the proper flow above. Never reuse a
   revoked value.

### Rotate tokens after pair-programming sessions

If you used a PAT during a debugging session — especially one shared with an
AI assistant — rotate it at https://github.com/settings/tokens. Tokens that
appear in any kind of log (shell history, screen recording, AI transcript)
should be considered compromised.

## Known Limitations of v0.1.x-alpha

The alpha ships with **mock adapters** for native dependencies. None of the
following actually run in production:

- **Screen capture** uses mock RGBA frames via `setInterval`. Real Windows
  Graphics Capture binding is deferred to v0.2.
- **FFmpeg** export uses `MockFfmpegAdapter` (simulated progress, no file
  written). Real `fluent-ffmpeg` integration is deferred to v0.2.
- **SQLite** library uses `InMemoryAdapter`. Real `better-sqlite3` binding
  is deferred to v0.2.

As a result, **the v0.1.x-alpha builds cannot leak user data through these
agents** — they don't touch the disk, the network or the OS. Sanitizer
patterns are tested against fixture strings only.

The first version that interacts with real user data will be **v0.2.0**, at
which point this document will be revised with the relevant threat model.

## Sanitizer Limitations

The Gardien agent detects 10 well-known secret patterns with regex matches.
It is a **best-effort** filter, not a guarantee:

- It does not see what's on screen unless OCR is run upstream
- It will miss secrets in formats it doesn't recognize (custom tokens,
  homegrown formats, encoded blobs)
- It may produce false positives on legitimate strings matching the patterns
  (especially generic ones like `[a-zA-Z0-9_-]{40,}` for AWS secrets)

Treat it as defense in depth. Always review your recordings before sharing.
