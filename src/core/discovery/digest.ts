import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SkillRef } from '../types.js'
import { type CandidateManifest, candidateManifest } from './candidate.js'

const run = promisify(execFile)

/**
 * Content identity of a skill, independent of git. This is the only identifier
 * available for the non-git skills, which are the majority by count, so it —
 * not the commit — is what binds release evidence to the bytes released.
 *
 * A pure function of the manifest, so the bytes gated, snapshotted and packaged
 * are the same set by construction rather than by three exclusion lists agreeing.
 */
export async function skillDigest(manifest: CandidateManifest): Promise<string> {
  const outer = createHash('sha256')
  for (const entry of manifest.entries) {
    if (entry.kind === 'symlink') {
      const target = createHash('sha256').update(entry.target).digest('hex')
      outer.update(`${entry.relPath}\0l\0${target}\n`)
    } else {
      const bytes = await readFile(join(manifest.root, entry.relPath))
      const inner = createHash('sha256').update(bytes).digest('hex')
      outer.update(`${entry.relPath}\0f\0${entry.exec ? '1' : '0'}\0${inner}\n`)
    }
  }
  return `sha256:${outer.digest('hex')}`
}

export const digestSkill = async (skill: SkillRef): Promise<string> =>
  skillDigest(await candidateManifest(skill))

export interface GitState {
  commit: string | null
  dirty: boolean
}

export async function gitState(repoPath: string, relPath: string): Promise<GitState> {
  try {
    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: repoPath })
    const status = await run('git', ['status', '--porcelain', '--', relPath], { cwd: repoPath })
    return { commit: head.stdout.trim(), dirty: status.stdout.trim().length > 0 }
  } catch {
    return { commit: null, dirty: false }
  }
}
