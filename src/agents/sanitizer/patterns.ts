import type { SanitizePattern, DetectedZone } from '../../../interfaces'

/**
 * Type de zone associé à un pattern, pour mapping cohérent dans l'analyzer.
 * On utilise le même union type que DetectedZone.type.
 */
export type ZoneType = DetectedZone['type']

/**
 * Extension interne de SanitizePattern : on ajoute le type de zone
 * pour pouvoir l'attribuer automatiquement lors de la détection.
 * On expose la version "publique" via PATTERNS qui reste conforme à SanitizePattern.
 */
export interface SanitizePatternWithType extends SanitizePattern {
  zoneType: ZoneType
}

/**
 * Catalogue P0 des patterns de détection de secrets.
 * Ordre : du plus spécifique au plus générique pour limiter le double-matching
 * (l'analyzer peut filtrer/agréger derrière).
 */
export const PATTERNS: SanitizePatternWithType[] = [
  {
    // Anthropic must come BEFORE the generic sk- catch-all so its
    // more specific match wins the precedence inside our overlap merger.
    name: 'anthropic-api-key',
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:anthropic-api-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // Modern OpenAI project keys start with `sk-proj-` and are longer.
    // Catch them with their own narrow pattern BEFORE the generic
    // sk- catch-all so the overlap merger keeps the more precise label.
    name: 'openai-project-key',
    regex: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:openai-project-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // Catches OpenAI (`sk-XXX`), Stripe (`sk_live_XXX`, `sk_test_XXX`),
    // and any other vendor that uses an `sk` prefix followed by `-` or `_`.
    // 16+ chars after the prefix to avoid matching `sk-foo` in a sentence.
    name: 'sk-prefixed-key',
    regex: /\bsk[-_][A-Za-z0-9_]{16,}\b/g,
    replacement: '[REDACTED:sk-key]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // Stripe restricted keys (limited-scope variants of sk_).
    name: 'stripe-restricted-key',
    regex: /\brk_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
    replacement: '[REDACTED:stripe-restricted]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // Stripe public keys — not strictly a secret but you usually do not
    // want them on screen during a demo either; lower confidence so the
    // analyzer can dedupe with sk- if both fire.
    name: 'stripe-publishable-key',
    regex: /\bpk[-_](?:live|test)_[A-Za-z0-9]{16,}\b/g,
    replacement: '[REDACTED:stripe-pk]',
    confidence: 0.9,
    zoneType: 'api-key'
  },
  {
    name: 'github-token',
    regex: /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/g,
    replacement: '[REDACTED:github-pat]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'slack-token',
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED:slack-token]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    name: 'google-oauth-token',
    regex: /\bya29\.[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:google-oauth]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // Google OAuth client secret — the value the user gets from
    // Google Cloud Console "Identifiants" → "Codes secrets du client".
    // Always starts with the literal "GOCSPX-" prefix.
    name: 'google-client-secret',
    regex: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:google-client-secret]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // Notion internal integration token — what you get in "Jeton
    // d'intégration" → "Jeton d'accès" on a Notion workspace's API
    // settings. The `ntn_` prefix is mandatory.
    name: 'notion-integration-token',
    regex: /\bntn_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:notion-token]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // Notion legacy integration tokens use the `secret_` prefix.
    // 43 chars in practice but we accept 30+ to absorb OCR jitter.
    name: 'notion-legacy-token',
    regex: /\bsecret_[A-Za-z0-9]{30,}\b/g,
    replacement: '[REDACTED:notion-legacy-token]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // SendGrid API key — strict fixed-length structure makes it safe.
    name: 'sendgrid-api-key',
    regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    replacement: '[REDACTED:sendgrid-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // Discord bot token: 3 dot-separated base64-url chunks, prefix
    // depends on snowflake (M, N, O for newer ones).
    name: 'discord-bot-token',
    regex: /\b[MNO][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
    replacement: '[REDACTED:discord-bot]',
    confidence: 0.9,
    zoneType: 'api-key'
  },
  {
    // Database URL with embedded credentials (postgres, mysql, mongodb,
    // redis). The `user:pass@host` shape is unambiguous → high confidence.
    name: 'database-url-with-credentials',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb|redis)(?:\+srv)?:\/\/[^:\s/]+:[^@\s/]+@[^/\s]+/gi,
    replacement: '[REDACTED:database-url]',
    confidence: 0.98,
    zoneType: 'credential'
  },
  {
    // Header of any kind of private key block (RSA, OPENSSH, PGP, ...).
    // We mask the line so any key material below stays hidden, even
    // partially OCR'd.
    name: 'private-key-header',
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED:private-key-header]',
    confidence: 0.99,
    zoneType: 'credential'
  },
  {
    name: 'aws-access-key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED:aws-access-key]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // AWS secret access keys are 40-char base64. Naked the pattern
    // matches ANY 40-char alpha-numeric string — UUIDs, hashes, IDs —
    // and explodes in false positives. Tighten to require the
    // surrounding "AWS secret" context.
    name: 'aws-secret-key',
    regex:
      /\b(?:AWS(?:_SECRET)?_ACCESS_KEY|aws[\s_-]*secret[\s_-]*access[\s_-]*key|aws[\s_-]*secret(?:[\s_-]*key)?)\s*[:=]\s*["']?[a-zA-Z0-9/+=]{40}\b/gi,
    replacement: '[REDACTED:aws-secret-key]',
    confidence: 0.95,
    zoneType: 'credential'
  },
  {
    name: 'bearer-token',
    regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
    replacement: '[REDACTED:bearer-token]',
    confidence: 0.9,
    zoneType: 'bearer-token'
  },
  {
    name: 'jwt',
    regex: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    replacement: '[REDACTED:jwt]',
    confidence: 0.95,
    zoneType: 'jwt'
  },
  {
    // env-var of the form NAME=value where NAME contains a secret-y
    // keyword. The previous regex `[A-Z_]+=[^\s]{8,}` matched ANY
    // UPPER_SNAKE assignment — Kubernetes configs, page IDs, query
    // params, you name it. Restrict to names that actually look like
    // they carry a credential.
    name: 'env-var',
    regex:
      /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|AUTH|CREDENTIAL|PRIVATE|API)[A-Z0-9_]*=[^\s"'`]{8,}/g,
    replacement: '[REDACTED:env-var]',
    confidence: 0.85,
    zoneType: 'env-var'
  },
  {
    // Credit-card numbers always come in 4 groups of 4 digits, with
    // optional space or dash as separator. The old regex
    // `\b(?:\d[ -]*?){13,16}\b` also caught phone numbers, long IDs
    // and timestamps because it allowed any digit positioning.
    name: 'credit-card',
    regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
    replacement: '[REDACTED:credit-card]',
    confidence: 0.85,
    zoneType: 'credit-card'
  },
  {
    name: 'generic-api-key',
    regex: /(?:api[_-]?key|apikey)["\s:=]+["']?([a-zA-Z0-9_-]{20,})/gi,
    replacement: '[REDACTED:generic-api-key]',
    confidence: 0.85,
    zoneType: 'api-key'
  },
  {
    name: 'n8n-webhook',
    regex: /https?:\/\/[^/]+\/webhook\/[a-zA-Z0-9-]+/g,
    replacement: '[REDACTED:n8n-webhook]',
    confidence: 0.9,
    zoneType: 'credential'
  }
]
