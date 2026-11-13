import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolLockEntry } from '../../src/core/config/config.js'
import type { Ledger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import type { SkillRef, Stage, StageOutcome } from '../../src/core/types.js'

/**
 * vercel `skills` 1.5.21's own shape, which is all the release stage asks of
 * it: exit 0 and a line on stdout is "installable", exit 1 is not. A stand-in
 * script rather than a mock because the stage spawns it as a real process.
 */
export async function fakeSkillsBin(exitCode = 0): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
  const bin = join(dir, 'skills')
  await writeFile(
    bin,
    exitCode === 0
      ? '#!/bin/sh\necho "Installed 1 skill"\nexit 0\n'
      : '#!/bin/sh\necho "No valid skills found." >&2\nexit 1\n',
  )
  await chmod(bin, 0o755)
  return bin
}

export const skillsLockEntry = (bin: string): ToolLockEntry => ({
  installKind: 'npm-prefix',
  requestedPin: '1.5.21',
  resolvedVersion: '1.5.21',
  bin,
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
})

export type GateOutcomes = Partial<Record<'validate' | 'evaluate' | 'security', StageOutcome>>

/**
 * One recorded run over the gate stages named in `outcomes`, all against
 * `digest`. A stage left out is a stage the run never executed, which is how a
 * test makes one gate older than another: two calls, two run ids.
 */
export function seedGates(
  ledger: Ledger,
  skill: SkillRef,
  spec: { digest: string; runId?: string; outcomes?: GateOutcomes },
): string {
  const runId = spec.runId ?? '019000000000-a'
  const outcomes: GateOutcomes = spec.outcomes ?? {
    validate: 'passed',
    evaluate: 'passed',
    security: 'passed',
  }
  const stages = (Object.entries(outcomes) as Array<[Stage, StageOutcome]>).map(
    ([stage, outcome]) => ({
      stage,
      outcome,
      verdict: outcome === 'failed' ? ('failed' as const) : ('passed' as const),
      toolRuns: [],
    }),
  )
  recordRun(ledger, {
    skill,
    runId,
    trigger: 'test',
    startedAt: '2026-08-01T00:00:00Z',
    endedAt: '2026-08-01T00:01:00Z',
    outcome: stages.every((s) => s.outcome === 'passed') ? 'passed' : 'failed',
    skillDigest: spec.digest,
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: join(skill.workspacePath, 'skillgantry', 'runs', runId),
    stages,
  })
  return runId
}
