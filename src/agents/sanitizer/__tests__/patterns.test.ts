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
    name: 'aws-access-key',
    positive: 'AKIAIOSFODNN7EXAMPLE is the key',
    negative: 'AKIA-short or just AKIA123'
  },
  {
    name: 'aws-secret-key',
    // exactement 40 chars base64-like
    positive: 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12',
    negative: 'too short for an aws secret'
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
    positive: 'DATABASE_URL=postgres://user:pass@host',
    negative: 'lowercase = ignored123'
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
