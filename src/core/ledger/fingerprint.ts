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
