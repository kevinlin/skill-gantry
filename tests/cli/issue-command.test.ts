import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/run-command.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { listIssues } from '../../src/core/ledger/issue-queries.js'
import { type Headless, makeHeadless } from '../helpers/headless.js'
import { recordFixtureRun } from '../helpers/ledger-fixture.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'
import { treeSnapshot } from '../helpers/tree.js'

/** One open issue, filed by a failed security stage — what `status` lists and a fingerprint names. */
async function withIssue(): Promise<{ h: Headless; fingerprint: string }> {
  const h = await makeHeadless({ repos: [{ 'sk/SKILL.md': SKILL_MD_FULL('sk') }] })
  const [skill] = await h.skills()
  const ledger = openLedger(h.dbPath)
  try {
    recordFixtureRun(ledger, {
      runId: '019000000000-s',
      skill: skill!,
      stages: [
        {
          stage: 'security',
          outcome: 'failed',
          findings: [
            {
              ruleClass: 'prompt-injection',
              nativeRuleId: 'P2',
              severity: 'high',
              path: 'SKILL.md',
              line: 3,
              message: 'interpolates untrusted text',
            },
          ],
        },
      ],
    })
    const [issue] = listIssues(ledger.db, {})
    return { h, fingerprint: issue!.fingerprint }
  } finally {
    ledger.close()
  }
}

/** Read through a fresh handle: the state the command left, not a cached one. */
function stateOf(h: Headless, fingerprint: string): string | undefined {
  const ledger = openLedger(h.dbPath)
  try {
    return listIssues(ledger.db, {}).find((issue) => issue.fingerprint === fingerprint)?.state
  } finally {
    ledger.close()
  }
}

describe('skillgantry issue', () => {
  it('exits 0 and reports the new state when the issue moved', async () => {
    const { h, fingerprint } = await withIssue()

    expect(await h.run(['issue', fingerprint, 'acknowledge', '--json'])).toBe(0)

    expect(h.json()).toEqual({ fingerprint, state: 'acknowledged' })
    expect(stateOf(h, fingerprint)).toBe('acknowledged')
    expect(h.err).toEqual([])
  })

  it('applies every user transition of R8.10 in turn', async () => {
    const { h, fingerprint } = await withIssue()

    for (const [action, state] of [
      ['acknowledge', 'acknowledged'],
      ['wontfix', 'wontfix'],
      ['reopen', 'open'],
    ] as const) {
      h.out.length = 0
      expect(await h.run(['issue', fingerprint, action, '--json'])).toBe(0)
      expect(h.json()).toEqual({ fingerprint, state })
      expect(stateOf(h, fingerprint)).toBe(state)
    }
  })

  it('prints the fingerprint and the new state as one line without --json', async () => {
    const { h, fingerprint } = await withIssue()

    expect(await h.run(['issue', fingerprint, 'wontfix'])).toBe(0)

    expect(h.out).toEqual([`${fingerprint}  wontfix`])
  })

  it('exits 1 with one line naming the current state when the transition is not legal, and writes nothing', async () => {
    const { h, fingerprint } = await withIssue()

    // An open issue cannot be reopened: that is a no from the state machine,
    // not a bad request, so it is 1 and not 2.
    expect(await h.run(['issue', fingerprint, 'reopen'])).toBe(1)

    expect(h.out).toHaveLength(1)
    expect(h.out[0]).toContain(fingerprint)
    expect(h.out[0]).toMatch(/\bopen\b/)
    expect(h.err).toEqual([])
    expect(stateOf(h, fingerprint)).toBe('open')
  })

  it('names the state the issue is in under --json too, so the exit code alone says it did not move', async () => {
    const { h, fingerprint } = await withIssue()
    expect(await h.run(['issue', fingerprint, 'wontfix'])).toBe(0)

    h.out.length = 0
    // `acknowledge` from `wontfix` is refused: quietly weakening a suppression
    // would lose a decision the user made.
    expect(await h.run(['issue', fingerprint, 'acknowledge', '--json'])).toBe(1)

    expect(h.json()).toEqual({ fingerprint, state: 'wontfix' })
    expect(stateOf(h, fingerprint)).toBe('wontfix')
  })

  it('exits 2 for a fingerprint no issue has, as one error line, and writes nothing', async () => {
    const { h, fingerprint } = await withIssue()

    expect(await h.run(['issue', 'f'.repeat(64), 'acknowledge'])).toBe(2)

    expect(h.err).toEqual([`error: no issue has fingerprint ${'f'.repeat(64)}`])
    expect(h.out).toEqual([])
    expect(stateOf(h, fingerprint)).toBe('open')
  })

  it('exits 2 for an action it does not know, naming the three it does, and writes nothing', async () => {
    const { h, fingerprint } = await withIssue()

    expect(await h.run(['issue', fingerprint, 'resolve'])).toBe(2)

    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toContain('resolve')
    for (const action of ['acknowledge', 'wontfix', 'reopen']) expect(h.err[0]).toContain(action)
    expect(stateOf(h, fingerprint)).toBe('open')
  })

  it('turns both bad requests into the JSON error document under --json', async () => {
    const { h, fingerprint } = await withIssue()

    expect(await h.run(['issue', 'f'.repeat(64), 'reopen', '--json'])).toBe(2)
    expect(h.json<{ error: { message: string } }>().error.message).toContain('no issue')

    h.out.length = 0
    expect(await h.run(['issue', fingerprint, 'resolve', '--json'])).toBe(2)
    expect(h.json<{ error: { message: string } }>().error.message).toContain('resolve')
  })

  it('rejects rather than catching its own errors, so the one handler in main() sees them', async () => {
    const { h, fingerprint } = await withIssue()

    await expect(
      buildProgram(h.deps).parseAsync(['node', 'sg', 'issue', 'f'.repeat(64), 'reopen']),
    ).rejects.toThrow(/no issue has fingerprint/)
    await expect(
      buildProgram(h.deps).parseAsync(['node', 'sg', 'issue', fingerprint, 'resolve']),
    ).rejects.toThrow(/acknowledge/)
    expect(stateOf(h, fingerprint)).toBe('open')
  })

  it('writes the ledger alone: the repo and the sidecar are byte-identical afterwards', async () => {
    const { h, fingerprint } = await withIssue()
    const before = await treeSnapshot(h.repos[0]!)

    expect(await h.run(['issue', fingerprint, 'acknowledge'])).toBe(0)

    expect(await treeSnapshot(h.repos[0]!)).toEqual(before)
  })
})
