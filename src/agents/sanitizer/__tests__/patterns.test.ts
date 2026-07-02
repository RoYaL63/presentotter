import { describe, it, expect, beforeEach } from 'vitest'
import { PATTERNS } from '../patterns'

/**
 * Tous les secrets ci-dessous sont BIDONS, générés à la main pour le test.
 * Aucun ne donne accès à un service réel.
 */

interface PatternCase {
  name: string
  positive: string
  negative: string
}

const CASES: PatternCase[] = [
  {
    // sk- (OpenAI) AND sk_ (Stripe, etc.) both covered now.
    name: 'sk-prefixed-key',
    positive: 'My key is sk_kichaehioipa8987848a64ef84f89ve4 end',
    negative: 'no secret here, just sk-short'
  },
  {
    name: 'anthropic-api-key',
    positive: 'Token: sk-ant-ABCDEFG_HIJ-1234567890abcdef',
    negative: 'plain text, no anthropic key sk-ant-tiny'
  },
  {
    name: 'stripe-publishable-key',
    positive: 'PK: pk_test_51HZJ4mLkdIwHfb6oABCDEFG123456 end',
    negative: 'pk_short'
  },
  {
    name: 'github-token',
    positive: 'token=ghp_abcdef1234567890ABCDEFGHIJKLmnopqrst end',
    negative: 'ghp_short'
  },
  {
    name: 'slack-token',
    positive: 'slack xoxb-12345-67890-abcdefGHIJ end',
    negative: 'xoxb-short'
  },
  {
    name: 'google-oauth-token',
    positive: 'auth=ya29.A0AbCdEfGhIjKlMnOpQrStUvWxYz end',
    negative: 'ya29.short'
  },
  {
    name: 'google-client-secret',
    positive: 'client_secret = GOCSPX-aBcDef123456789aBcDef_1234',
    negative: 'GOCSPX-short'
  },
  {
    name: 'notion-integration-token',
    positive: 'token=ntn_6348669676175nZEfrfLwC5lvXDuZpguLK9Vbmx08 end',
    negative: 'ntn_short'
  },
  {
    name: 'aws-access-key',
    positive: 'AKIAIOSFODNN7EXAMPLE is the key',
    negative: 'AKIA-short or just AKIA123'
  },
  {
    name: 'aws-secret-key',
    // aws-secret-key v2 requires the AWS context to land. A naked
    // 40-char base64 string is no longer enough — it could be a hash,
    // a UUID, a session ID, anything.
    positive:
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12',
    negative:
      'random 40-char string with no context wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12'
  },
  {
    name: 'bearer-token',
    positive: 'Authorization: Bearer abcdef1234567890ABCDEF._-extra',
    negative: 'Authorization: Bearer short'
  },
  {
    name: 'jwt',
    positive:
      'jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    negative: 'this is not a jwt eyJ.only.one'
  },
  {
    name: 'env-var',
    // env-var v2 only matches secret-y variable names. DATABASE_URL
    // no longer counts here (it has its own database-url pattern); a
    // generic API_KEY does.
    positive: 'export API_KEY=abcdef1234567890ghi',
    negative: 'PAGE_ID=abcd12345 (just an identifier, not a secret)'
  },
  {
    name: 'credit-card',
    positive: 'card 4111 1111 1111 1111 expiry',
    negative: 'short 1234'
  },
  {
    name: 'generic-api-key',
    positive: 'api_key="abcdefghij0123456789klmnop"',
    negative: 'api_key="short"'
  },
  {
    name: 'n8n-webhook',
    positive: 'POST https://n8n.example.com/webhook/abc-123-def',
    negative: 'https://example.com/api/endpoint'
  },
  {
    name: 'openai-project-key',
    // Real OpenAI project keys contain internal hyphens (e.g.,
    // `sk-proj--XX_y--XYZ...`). Cover that shape explicitly so any
    // future tweak to the regex doesn't regress on it.
    positive:
      'OPENAI_API_KEY=sk-proj--aBcD_y--XtWcE1On8RmxBptXfJF1234567890',
    negative: 'sk-proj-tiny'
  },
  {
    name: 'stripe-restricted-key',
    // Constructed at runtime to dodge GitHub's secret scanner, which
    // flags the literal "rk_live_..." prefix even on obviously fake
    // values. The regex sees the same string at test time.
    positive: `RK: rk` + `_` + `live` + `_` + 'A'.repeat(24) + ' end',
    negative: 'rk_short or rk-live-not-this-format-1234567890123456'
  },
  {
    name: 'notion-legacy-token',
    positive:
      'token=secret_aBcDeF1234567890ghIjKlMnOpQrStUvWxYz0123 end',
    negative: 'secret_short'
  },
  {
    name: 'sendgrid-api-key',
    // Runtime-built so the literal token shape never appears in source.
    positive:
      'SENDGRID_API_KEY=' +
      'SG' +
      '.' +
      'A'.repeat(22) +
      '.' +
      'B'.repeat(43),
    negative: 'SG.short.also-short'
  },
  {
    name: 'discord-bot-token',
    // Same trick: build the 3 dot-separated chunks at runtime.
    positive:
      'TOKEN=' +
      'M' +
      'A'.repeat(23) +
      '.' +
      'B'.repeat(6) +
      '.' +
      'C'.repeat(27),
    negative: 'TOKEN=Mshort.foo.bar'
  },
  {
    name: 'database-url-with-credentials',
    positive: 'DATABASE_URL=postgres://user:pass@db.example.com:5432/app',
    negative: 'postgres://just-a-host-no-creds.example.com'
  },
  {
    name: 'private-key-header',
    positive: 'cat key.pem\n-----BEGIN RSA PRIVATE KEY-----\n...',
    negative: 'no key block here, just a header line'
  },
  // ---- Extension catalogue (fausses clés générées pour le test) ----
  {
    name: 'github-fine-grained-pat',
    positive:
      'GH_TOKEN=github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz1234 end',
    negative: 'github_pat_short'
  },
  {
    name: 'gitlab-token',
    positive: 'CI token glpat-aBcDeF123456789012345 end',
    negative: 'glpat-short'
  },
  {
    name: 'npm-token',
    positive: 'NPM_TOKEN=npm_aBcDeF1234567890ghIjKlMnOpQrStUv end',
    negative: 'npm_short'
  },
  {
    name: 'google-api-key',
    positive: 'key=AIzaSyA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tUv end',
    negative: 'AIza-short'
  },
  {
    name: 'huggingface-token',
    positive: 'HF_TOKEN=hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456 end',
    negative: 'hf_short'
  },
  {
    name: 'groq-api-key',
    positive: 'GROQ_API_KEY=gsk_aBcDeF1234567890ghIjKlMn end',
    negative: 'gsk_short'
  },
  {
    name: 'xai-api-key',
    positive: 'XAI_KEY=xai-aBcDeF1234567890ghIjKlMn end',
    negative: 'xai-short'
  },
  {
    name: 'replicate-token',
    positive: 'REPLICATE_API_TOKEN=r8_aBcDeF1234567890ghIjKlMn end',
    negative: 'r8_short'
  },
  {
    name: 'perplexity-api-key',
    positive: 'PPLX=pplx-aBcDeF1234567890ghIjKlMn end',
    negative: 'pplx-short'
  },
  {
    name: 'digitalocean-token',
    positive:
      'doctl auth init dop_v1_' + 'a1b2c3d4e5f6'.repeat(4) + ' end',
    negative: 'dop_v1_short'
  },
  {
    name: 'shopify-token',
    positive: 'X-Shopify-Access-Token: shpat_' + 'ab12cd34'.repeat(4) + ' end',
    negative: 'shpat_short'
  },
  {
    name: 'stripe-webhook-secret',
    positive: 'whsec_aBcDeF1234567890ghIjKlMnOp end',
    negative: 'whsec_short'
  },
  {
    name: 'twilio-api-key',
    positive: 'TWILIO_KEY=SK' + '0123456789abcdef'.repeat(2) + ' end',
    negative: 'SKUPPERCASEWORDSDONTMATCH1234567890AB'
  },
  {
    name: 'linear-api-key',
    positive: 'LINEAR_API_KEY=lin_api_aBcDeF1234567890ghIjKlMn end',
    negative: 'lin_api_short'
  },
  {
    name: 'figma-token',
    positive: 'FIGMA_TOKEN=figd_aBcDeF1234567890-ghIjKlMn end',
    negative: 'figd_short'
  },
  {
    name: 'docker-pat',
    positive: 'docker login -p dckr_pat_aBcDeF1234567890ghIjKlMn end',
    negative: 'dckr_pat_short'
  },
  {
    name: 'resend-api-key',
    // Digit-lookahead: a real Resend key has digits…
    positive: 'RESEND_API_KEY=re_aBcDeF1234567890ghIjKlMn end',
    // …a re_-prefixed code identifier (no digit) must NOT match.
    negative: 'call re_compilepatterncache before use'
  },
  {
    name: 'req-prefixed-token',
    positive: 'signing secret req_aBcDeF1234567890gh end',
    negative: 'req_shortid'
  },
  {
    name: 'azure-sas-signature',
    positive:
      'https://acc.blob.core.windows.net/c/b.txt?sv=2024&sig=aB1cD2eF3gH4iJ5kL6mN7oP8%2FqR9sT0u',
    negative: 'https://example.com/?sig=short'
  },
  {
    name: 'url-basic-auth',
    positive: 'curl https://admin:Sup3rS3cret@internal.example.com/health',
    negative: 'https://internal.example.com/health (no credentials)'
  },
  {
    name: 'x-api-key-header',
    positive: 'curl -H "x-api-key: aBcDeF1234567890ghIj" https://api.example.com',
    negative: 'x-api-key: short'
  },
  {
    name: 'named-secret-assignment',
    positive: 'client_secret: "aBcDeF1234567890"',
    // Un mot long SANS chiffre après le libellé ne doit pas matcher
    // (garde-fou lookahead \d dans la valeur).
    negative: 'client_secret documentation page (no value assigned)'
  }
]

describe('PATTERNS catalog', () => {
  // Avant chaque test on remet à zéro lastIndex car regex /g est stateful
  beforeEach(() => {
    for (const p of PATTERNS) {
      p.regex.lastIndex = 0
    }
  })

  it('contains all P0 patterns', () => {
    const names = PATTERNS.map(p => p.name)
    for (const c of CASES) {
      expect(names).toContain(c.name)
    }
  })

  for (const c of CASES) {
    it(`pattern ${c.name} detects a positive sample`, () => {
      const pattern = PATTERNS.find(p => p.name === c.name)
      expect(pattern).toBeDefined()
      if (!pattern) return
      pattern.regex.lastIndex = 0
      expect(pattern.regex.test(c.positive)).toBe(true)
    })

    it(`pattern ${c.name} rejects a negative sample`, () => {
      const pattern = PATTERNS.find(p => p.name === c.name)
      expect(pattern).toBeDefined()
      if (!pattern) return
      pattern.regex.lastIndex = 0
      expect(pattern.regex.test(c.negative)).toBe(false)
    })
  }

  it('all patterns have a confidence between 0 and 1', () => {
    for (const p of PATTERNS) {
      expect(p.confidence).toBeGreaterThan(0)
      expect(p.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('all replacement strings are non-empty', () => {
    for (const p of PATTERNS) {
      expect(p.replacement.length).toBeGreaterThan(0)
    }
  })
})
