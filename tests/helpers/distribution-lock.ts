import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withSkillLock } from '../../src/core/workspace/writer.js'

const checkout = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16)
const lockRoot = join(tmpdir(), `skillgantry-distribution-${checkout}`)

/**
 * Vitest runs acceptance files in separate workers. The packaging and local
 * install tests both compile into this checkout's `dist/`, so one pack could
 * otherwise read a module after the other compiler truncated it for rewrite.
 */
export function withDistributionLock<T>(fn: () => Promise<T>): Promise<T> {
  return withSkillLock(lockRoot, fn, 300_000)
}
