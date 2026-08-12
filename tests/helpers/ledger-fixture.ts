import { workspacePath } from '../../src/core/discovery/discover.js'
import { type Ledger, openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import type { Metrics, RawFinding, SkillRef, Stage, StageOutcome } from '../../src/core/types.js'
import { skillRef } from './skill-ref.js'

/** `skillRef` with the repo id spelled out, for the suites that assert on it. */
export const skillFixture = (repoId: string, name: string): SkillRef =>
  skillRef(`${repoId}/${name}`, {
    name,
    dir: `/${repoId}/${name}`,
    relPath: name,
    repo: { id: repoId, path: `/${repoId}`, name: repoId, isGit: false },
    workspacePath: workspacePath(`/${repoId}`, name, false),
  })

export interface StageSpec {
  stage: Stage
  outcome: StageOutcome
  /** Whole seconds of stage wall clock. */
  seconds?: number
  metrics?: Metrics
  findings?: RawFinding[]
  toolId?: string
}

export interface RunSpec {
  runId: string
  skill: ReturnType<typeof skillFixture>
  stages: StageSpec[]
  provenance?: Record<string, unknown>
  digest?: string
  /** R6.1's timestamped directory, for the queries that name a run by it. */
  sidecarPath?: string
}

/** Sequential ISO instants, so wall clock and run order are both assertable. */
const at = (offset: number): string => new Date(Date.UTC(2026, 7, 3, 10, 0, offset)).toISOString()

export function recordFixtureRun(ledger: Ledger, spec: RunSpec): void {
  let clock = 0
  recordRun(ledger, {
    skill: spec.skill,
    runId: spec.runId,
    trigger: 'test',
    startedAt: at(0),
    endedAt: at(60),
    outcome: spec.stages.at(-1)?.outcome ?? 'passed',
    skillDigest: spec.digest ?? 'sha256:abc',
    git: { commit: null, dirty: false },
    provenanceJson: JSON.stringify(spec.provenance ?? {}),
    toolLockJson: '{}',
    sidecarPath: spec.sidecarPath ?? `/tmp/${spec.runId}`,
    stages: spec.stages.map((stage) => {
      const startedAt = at(clock)
      clock += stage.seconds ?? 1
      return {
        stage: stage.stage,
        outcome: stage.outcome,
        verdict: stage.outcome === 'failed' ? ('failed' as const) : ('passed' as const),
        startedAt,
        endedAt: at(clock),
        metrics: stage.metrics ?? {},
        toolRuns: [
          {
            toolId: stage.toolId ?? 'skillspector',
            toolVersion: '2.5.1',
            outcome: stage.outcome === 'failed' ? ('failed' as const) : ('passed' as const),
            exitCode: 0,
            durationMs: (stage.seconds ?? 1) * 1000,
            errorKind: null,
            artefactDir: `/tmp/${spec.runId}/${stage.stage}`,
            findings: stage.findings ?? [],
            metrics: {},
            summary: '',
          },
        ],
      }
    }),
  })
}

export const memoryLedger = (): Ledger => openLedger(':memory:')
