import { describe, expect, it } from 'vitest'
import { listIssues, setIssueState } from '../../src/core/ledger/issue-queries.js'
import { stateOnUserAction } from '../../src/core/ledger/issues.js'
import { memoryLedger, recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'

const ALPHA = skillFixture('alpha', 'declawed')
const BETA = skillFixture('beta', 'spec-lint')

const finding = (
  path: string,
  ruleClass: string,
  severity: 'high' | 'low',
  toolId = 'skillspector',
) => ({
  ruleClass: ruleClass as never,
  nativeRuleId: 'X1',
  severity,
  path,
  message: `${toolId} says so`,
})

function seeded() {
  const ledger = memoryLedger()
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000001',
    skill: ALPHA,
    stages: [
      {
        stage: 'security',
        outcome: 'failed',
        findings: [finding('declawed/SKILL.md', 'prompt-injection', 'high')],
      },
    ],
  })
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000002',
    skill: BETA,
    stages: [
      {
        stage: 'validate',
        outcome: 'failed',
        toolId: 'skill-lint',
        findings: [finding('spec-lint/SKILL.md', 'metadata-invalid', 'low', 'skill-lint')],
      },
    ],
  })
  return ledger
}

describe('stateOnUserAction — design §10.5', () => {
  it('acknowledges an open issue', () => {
    expect(stateOnUserAction('open', 'acknowledge')).toBe('acknowledged')
  })

  it('refuses to acknowledge a wontfix, which would read as un-suppressing it', () => {
    expect(stateOnUserAction('wontfix', 'acknowledge')).toBeNull()
  })

  it('marks any live or closed issue wontfix', () => {
    expect(stateOnUserAction('open', 'wontfix')).toBe('wontfix')
    expect(stateOnUserAction('acknowledged', 'wontfix')).toBe('wontfix')
    expect(stateOnUserAction('fixed', 'wontfix')).toBe('wontfix')
  })

  it('reopens from every state that is not already open', () => {
    expect(stateOnUserAction('acknowledged', 'reopen')).toBe('open')
    expect(stateOnUserAction('wontfix', 'reopen')).toBe('open')
    expect(stateOnUserAction('fixed', 'reopen')).toBe('open')
    expect(stateOnUserAction('open', 'reopen')).toBeNull()
  })
})

describe('listIssues — across every registered repo', () => {
  it('lists issues from both repos, most severe first', () => {
    const rows = listIssues(seeded().db, {})
    expect(rows.map((row) => row.repoId)).toEqual(['alpha', 'beta'])
    expect(rows[0]).toMatchObject({
      skillId: 'alpha/declawed',
      ruleClass: 'prompt-injection',
      relPath: 'declawed/SKILL.md',
      severity: 'high',
      state: 'open',
      detectors: ['skillspector'],
    })
  })

  it('narrows by repo, by skill, by state and by rule class', () => {
    const db = seeded().db
    expect(listIssues(db, { repoId: 'beta' })).toHaveLength(1)
    expect(listIssues(db, { skillId: 'alpha/declawed' })).toHaveLength(1)
    expect(listIssues(db, { ruleClass: 'metadata-invalid' })).toHaveLength(1)
    expect(listIssues(db, { state: 'wontfix' })).toEqual([])
  })

  it('names the detector that is holding an issue open', () => {
    const rows = listIssues(seeded().db, { skillId: 'alpha/declawed' })
    // The detector reported it and has never since reported a conclusive
    // absence, so it is exactly what reconcile would wait on.
    expect(rows[0]?.blockedBy).toEqual(['skillspector'])
  })

  // R6.1: the identity and the label are both projected, because a screen needs
  // the second and every join still needs the first.
  it('carries the last sighting as both the run id and the run directory', () => {
    const ledger = memoryLedger()
    recordFixtureRun(ledger, {
      runId: '019283af-0000-7000-8000-000000000009',
      skill: ALPHA,
      // A collision suffix the clock cannot reproduce, so the projection is
      // proved to read the recorded path rather than reformat `started_at`.
      sidecarPath: '/tmp/declawed-workspace/skillgantry/runs/2026-08-03_10-00-00-2',
      stages: [
        {
          stage: 'security',
          outcome: 'failed',
          findings: [finding('declawed/SKILL.md', 'prompt-injection', 'high')],
        },
      ],
    })
    expect(listIssues(ledger.db, {})[0]).toMatchObject({
      lastSeenRun: '019283af-0000-7000-8000-000000000009',
      lastSeenRunDir: '2026-08-03_10-00-00-2',
    })
  })

  it('keeps the sighting when no run row is left to name it', () => {
    const ledger = seeded()
    // The left join's whole point: an inner one would drop the issue from the
    // audit surface because the run it names is gone.
    ledger.db.prepare(`update issues set last_seen_run = 'vanished'`).run()
    const row = listIssues(ledger.db, { repoId: 'alpha' })[0]
    expect(row?.lastSeenRun).toBe('vanished')
    expect(row?.lastSeenRunDir).toBeNull()
  })
})

describe('setIssueState', () => {
  it('persists an acknowledgement', () => {
    const ledger = seeded()
    const fp = listIssues(ledger.db, { repoId: 'alpha' })[0]?.fingerprint as string
    expect(setIssueState(ledger.db, fp, 'acknowledge')).toBe('acknowledged')
    expect(listIssues(ledger.db, { repoId: 'alpha' })[0]?.state).toBe('acknowledged')
  })

  it('returns null and writes nothing when the transition is not legal', () => {
    const ledger = seeded()
    const fp = listIssues(ledger.db, { repoId: 'alpha' })[0]?.fingerprint as string
    expect(setIssueState(ledger.db, fp, 'reopen')).toBeNull()
    expect(listIssues(ledger.db, { repoId: 'alpha' })[0]?.state).toBe('open')
  })

  it('clears closed_run when it reopens a fixed issue, so the row is not both fixed and open', () => {
    const ledger = seeded()
    const fp = listIssues(ledger.db, { repoId: 'alpha' })[0]?.fingerprint as string
    ledger.db
      .prepare(`update issues set state = 'fixed', closed_run = 'r0' where fingerprint = ?`)
      .run(fp)
    expect(setIssueState(ledger.db, fp, 'reopen')).toBe('open')
    const row = ledger.db
      .prepare('select state, closed_run from issues where fingerprint = ?')
      .get(fp) as { state: string; closed_run: string | null }
    expect(row).toEqual({ state: 'open', closed_run: null })
  })
})

describe('listIssues — suppression (R8.15)', () => {
  const suppressed = { justification: 'accepted false positive' }

  /** ALPHA's prompt-injection issue, reported suppressed by its only detector. */
  function withSuppressed() {
    const ledger = seeded()
    recordFixtureRun(ledger, {
      runId: '019283af-0000-7000-8000-000000000003',
      skill: ALPHA,
      stages: [
        {
          stage: 'security',
          outcome: 'passed',
          findings: [
            { ...finding('declawed/SKILL.md', 'prompt-injection', 'high'), suppressed },
          ],
        },
      ],
    })
    return ledger
  }

  it('keeps a suppressed issue in the default listing, marked and sorted last', () => {
    const rows = listIssues(withSuppressed().db, {})
    expect(rows).toHaveLength(2)
    // `high` would otherwise head the list; suppression demotes it.
    expect(rows.map((r) => r.suppressed)).toEqual([false, true])
    expect(rows[1]).toMatchObject({
      skillId: 'alpha/declawed',
      state: 'open',
      suppressed: true,
      suppressionReason: suppressed.justification,
    })
  })

  it('narrows both ways when the filter is supplied', () => {
    const { db } = withSuppressed()
    expect(listIssues(db, { suppressed: true }).map((r) => r.skillId)).toEqual(['alpha/declawed'])
    expect(listIssues(db, { suppressed: false }).map((r) => r.skillId)).toEqual(['beta/spec-lint'])
  })

  it('reports an unsuppressed issue as such, with no reason', () => {
    const rows = listIssues(seeded().db, {})
    expect(rows.every((r) => r.suppressed === false)).toBe(true)
    expect(rows[0]?.suppressionReason).toBeNull()
  })
})
