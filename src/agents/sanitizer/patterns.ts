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
    // Body allows `-` so multi-segment tokens like `sk-proj-abc-xyz` and
    // Anthropic-style `sk-ant-xxx` (when the more specific regex misses
    // them) still get caught here. 16+ body chars rule out `sk-foo` in a
    // sentence.
    name: 'sk-prefixed-key',
    regex: /\bsk[-_][A-Za-z0-9_-]{16,}\b/g,
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
    // GitHub fine-grained personal access tokens (new format, 2022+).
    // Distinct prefix from the classic gh?_ tokens above.
    name: 'github-fine-grained-pat',
    regex: /\bgithub_pat_[A-Za-z0-9_]{36,}\b/g,
    replacement: '[REDACTED:github-fine-pat]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'gitlab-token',
    regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:gitlab-pat]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'npm-token',
    regex: /\bnpm_[A-Za-z0-9]{30,}\b/g,
    replacement: '[REDACTED:npm-token]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // xox[abprs]- classic Slack tokens + xapp- app-level tokens.
    name: 'slack-token',
    regex: /\bx(?:ox[abprs]|app)-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED:slack-token]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // Google API keys (Maps, Gemini, Firebase…) all share the AIza prefix.
    // Official length is 39 total; 30+ body absorbs OCR truncation.
    name: 'google-api-key',
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replacement: '[REDACTED:google-api-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'huggingface-token',
    regex: /\bhf_[A-Za-z0-9]{28,}\b/g,
    replacement: '[REDACTED:hf-token]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'groq-api-key',
    regex: /\bgsk_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:groq-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'xai-api-key',
    regex: /\bxai-[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:xai-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'replicate-token',
    regex: /\br8_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:replicate-token]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'perplexity-api-key',
    regex: /\bpplx-[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:pplx-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'tavily-api-key',
    regex: /\btvly-[A-Za-z0-9_-]{16,}\b/g,
    replacement: '[REDACTED:tavly-key]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // DigitalOcean tokens: dop_v1_ (personal), doo_v1_ (OAuth), dor_v1_
    // (refresh). Body is 64 hex chars; 40+ absorbs OCR truncation.
    name: 'digitalocean-token',
    regex: /\bdo[opr]_v1_[a-f0-9]{40,}\b/g,
    replacement: '[REDACTED:do-token]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // Shopify: shpat_ (admin), shpca_ (custom app), shpss_ (shared secret).
    name: 'shopify-token',
    regex: /\bshp(?:at|ca|ss)_[a-fA-F0-9]{28,}\b/g,
    replacement: '[REDACTED:shopify-token]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'stripe-webhook-secret',
    regex: /\bwhsec_[A-Za-z0-9]{24,}\b/g,
    replacement: '[REDACTED:stripe-whsec]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    // Twilio API key SID / auth token shapes: SK + 32 lowercase hex.
    // Case-sensitive body — an all-caps word starting with SK won't match.
    name: 'twilio-api-key',
    regex: /\bSK[a-f0-9]{32}\b/g,
    replacement: '[REDACTED:twilio-key]',
    confidence: 0.9,
    zoneType: 'api-key'
  },
  {
    // Airtable personal access tokens: pat + 14 alnum + '.' + hex tail.
    name: 'airtable-pat',
    regex: /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{40,}\b/g,
    replacement: '[REDACTED:airtable-pat]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    name: 'linear-api-key',
    regex: /\blin_api_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:linear-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'figma-token',
    regex: /\bfigd_[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:figma-token]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'docker-pat',
    regex: /\bdckr_pat_[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:docker-pat]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'pypi-token',
    regex: /\bpypi-[A-Za-z0-9_-]{40,}\b/g,
    replacement: '[REDACTED:pypi-token]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    name: 'netlify-token',
    regex: /\bnfp_[A-Za-z0-9]{30,}\b/g,
    replacement: '[REDACTED:netlify-token]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    name: 'postman-api-key',
    regex: /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/g,
    replacement: '[REDACTED:postman-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'supabase-token',
    regex: /\bsbp_[a-f0-9]{30,}\b/g,
    replacement: '[REDACTED:supabase-token]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    name: 'hubspot-pat',
    regex: /\bpat-(?:na|eu)\d*-[a-f0-9][a-f0-9-]{20,}\b/g,
    replacement: '[REDACTED:hubspot-pat]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // Brevo (ex-Sendinblue) API keys.
    name: 'brevo-api-key',
    regex: /\bxkeysib-[a-f0-9-]{30,}\b/g,
    replacement: '[REDACTED:brevo-key]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // Mailchimp keys: 32 hex + datacenter suffix (-us1 … -us21).
    name: 'mailchimp-api-key',
    regex: /\b[a-f0-9]{32}-us\d{1,2}\b/g,
    replacement: '[REDACTED:mailchimp-key]',
    confidence: 0.9,
    zoneType: 'api-key'
  },
  {
    // Resend keys are re_ + alnum. The lookahead requires at least one
    // digit in the body so ordinary re_-prefixed code identifiers
    // (re_compile_pattern…) don't get masked.
    name: 'resend-api-key',
    regex: /\bre_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:resend-key]',
    confidence: 0.9,
    zoneType: 'api-key'
  },
  {
    // req_-prefixed tokens (various vendors + request-signing secrets).
    // Same digit-lookahead guard as re_ above.
    name: 'req-prefixed-token',
    regex: /\breq_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16,}\b/g,
    replacement: '[REDACTED:req-token]',
    confidence: 0.85,
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
    // AKIA = long-term access key, ASIA = temporary (STS), ABIA/ACCA =
    // less common variants. Same 16-char uppercase body for all.
    name: 'aws-access-key',
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED:aws-access-key]',
    confidence: 0.95,
    zoneType: 'api-key'
  },
  {
    // Azure SAS tokens travel as a `sig=` query parameter. Masking the
    // signature alone is enough to make the URL unusable.
    name: 'azure-sas-signature',
    regex: /[?&]sig=[A-Za-z0-9%/+]{20,}={0,2}/g,
    replacement: '[REDACTED:azure-sas]',
    confidence: 0.9,
    zoneType: 'credential'
  },
  {
    // user:password@ in ANY http(s) URL (the database-url pattern above
    // only covers db schemes). The `:pass@` shape is unambiguous.
    name: 'url-basic-auth',
    regex: /\bhttps?:\/\/[^:\s/@]+:[^@\s/]{3,}@[^\s"'<>]+/gi,
    replacement: '[REDACTED:url-credentials]',
    confidence: 0.95,
    zoneType: 'credential'
  },
  {
    // X-API-Key header (curl snippets, Postman, API docs). The user's
    // exact "XAPI Key" case: `x-api-key: <value>` in any casing, with
    // or without the dashes.
    name: 'x-api-key-header',
    regex: /\bx[-_]?api[-_]?key["'\s:=]+["']?[A-Za-z0-9_\-.+/=]{16,}/gi,
    replacement: '[REDACTED:x-api-key]',
    confidence: 0.9,
    zoneType: 'api-key'
  },
  {
    // Named secret assignments in code/config: client_secret=…,
    // access_token: "…", refresh_token=…, secret_key=… — catches JSON,
    // YAML, .env and CLI output alike. Complements env-var (which only
    // matches UPPER_SNAKE names).
    name: 'named-secret-assignment',
    // Digit lookahead on the value: real secrets virtually always mix in
    // digits; prose words after "access_token " (e.g. "documentation")
    // don't, and must not be masked.
    regex:
      /\b(?:client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret[_-]?key|private[_-]?token)["'\s:=]+["']?(?=[A-Za-z0-9_\-./+=]*\d)[A-Za-z0-9_\-./+=]{12,}/gi,
    replacement: '[REDACTED:named-secret]',
    confidence: 0.9,
    zoneType: 'credential'
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
