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
    name: 'aws-access-key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED:aws-access-key]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    name: 'aws-secret-key',
    regex: /[a-zA-Z0-9/+=]{40}/g,
    replacement: '[REDACTED:aws-secret-key]',
    confidence: 0.6,
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
    name: 'env-var',
    regex: /[A-Z_]+=[^\s]{8,}/g,
    replacement: '[REDACTED:env-var]',
    confidence: 0.7,
    zoneType: 'env-var'
  },
  {
    name: 'credit-card',
    regex: /\b(?:\d[ -]*?){13,16}\b/g,
    replacement: '[REDACTED:credit-card]',
    confidence: 0.8,
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
