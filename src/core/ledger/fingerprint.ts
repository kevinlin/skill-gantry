import { createHash } from 'node:crypto'
import type { RuleClass } from '../types.js'

/**
 * Identity is (skill, path, rule class) and nothing else.
 *
 * No line number, so an edit elsewhere in the file cannot resurrect a triaged
 * issue. No message text and no tool id, so two scanners describing the same
 * problem in different words resolve to one issue with two detections. The
 * cost is that several occurrences of one class in one file collapse into one
 * issue; the detections table carries each occurrence separately.
 */
export function fingerprint(skillId: string, relPath: string, ruleClass: RuleClass): string {
  const normalisedPath = relPath.replace(/\\/g, '/')
  return createHash('sha256')
    .update(`${skillId} ${normalisedPath} ${ruleClass}`)
    .digest('hex')
    .slice(0, 12)
}

/**
 * Structural, not `Provenance` itself: the ledger depends on `adapters` and on
 * nothing else in the engine (design §3), and a value import of `config/env`
 * would make it depend on config to compute a hash.
 */
export interface ProvenanceLike {
  baseUrlHost?: string | null
  models?: Record<string, string | null>
  authTokenHash?: string | null
  analysisModes?: Record<string, string>
}

const sorted = (obj: Record<string, string | null> | undefined): [string, string | null][] =>
  Object.entries(obj ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * R7.6's grouping key. Hashed over a **fixed field order** with both maps
 * sorted, because `JSON.stringify` of the object would hash two identical
 * provenances differently for having been built in a different key order — and
 * a grouping key that depends on construction order groups nothing.
 */
export function provenanceFingerprint(p: ProvenanceLike): string {
  const canonical = JSON.stringify([
    p.baseUrlHost ?? null,
    sorted(p.models),
    p.authTokenHash ?? null,
    sorted(p.analysisModes as Record<string, string | null> | undefined),
  ])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}
