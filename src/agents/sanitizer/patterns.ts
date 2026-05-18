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
    name: 'openai-api-key',
    regex: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: '[REDACTED:openai-api-key]',
    confidence: 0.98,
    zoneType: 'api-key'
  },
  {
    name: 'anthropic-api-key',
    regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g,
    replacement: '[REDACTED:anthropic-api-key]',
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
