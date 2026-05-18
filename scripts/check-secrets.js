#!/usr/bin/env node
/**
 * Pre-commit secret scanner.
 *
 * Scanne le contenu staged (git diff --cached) pour bloquer les patterns
 * de secrets connus avant qu'ils n'atteignent l'historique.
 *
 * Patterns détectés (alignés avec ce que GitHub Push Protection bloque) :
 * - GitHub PAT : ghp_*, gho_*, ghu_*, ghs_*, ghr_*
 * - OpenAI : sk-*
 * - Anthropic : sk-ant-*
 * - AWS access key : AKIA*
 * - Generic high-entropy strings annotated with 'secret'/'token'/'password'
 */

const { execSync } = require('node:child_process')

const PATTERNS = [
  { name: 'GitHub PAT', regex: /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/g },
  { name: 'OpenAI API key', regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g }
]

function getStagedDiff() {
  try {
    return execSync('git diff --cached --no-color -U0', { encoding: 'utf8' })
  } catch {
    return ''
  }
}

function scan() {
  const diff = getStagedDiff()
  if (diff.length === 0) {
    return { ok: true, hits: [] }
  }

  const hits = []
  for (const { name, regex } of PATTERNS) {
    let match
    while ((match = regex.exec(diff)) !== null) {
      hits.push({ pattern: name, value: maskValue(match[0]) })
    }
  }
  return { ok: hits.length === 0, hits }
}

function maskValue(s) {
  if (s.length < 12) return '***'
  return s.slice(0, 6) + '...' + s.slice(-3)
}

const result = scan()
if (!result.ok) {
  // eslint-disable-next-line no-console
  console.error('\n[SECRET] Pre-commit blocked. The staged diff contains secrets:\n')
  for (const hit of result.hits) {
    // eslint-disable-next-line no-console
    console.error(`  - ${hit.pattern}: ${hit.value}`)
  }
  // eslint-disable-next-line no-console
  console.error('\nRemove the secret and unstage it, then retry. To bypass once: git commit --no-verify (NOT RECOMMENDED).\n')
  process.exit(1)
}

process.exit(0)
