import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { readLifecycleCache } from '../../src/core/ledger/lifecycle.js'
import { writeSandboxRecord } from '../../src/core/isolation/record.js'
import type { SkillRef } from '../../src/core/types.js'
import { type Headless, makeHeadless } from '../helpers/headless.js'
import { recordFixtureRun } from '../helpers/ledger-fixture.js'
import { seedGates } from '../helpers/release-fixture.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'
import { treeSnapshot } from '../helpers/tree.js'

interface StatusDoc {
  skill: Record<string, unknown>
  gates: Array<{
    stage: string
    outcome: string | null
    runId: string | null
    runDir: string | null
    current: boolean
  }>
  hasEvalSuite: boolean
  issues: {
    open: number
    suppressed: number
    bySeverity: Array<{ severity: string; count: number }>
    items: Array<Record<string, unknown>>
  }
  release: { ready: boolean; blockers: Array<{ code: string; message: string }>; dirty: string[]; unchecked: string[] }
  next: Array<{ command: string | null; why: string }>
}

const digestOf = async (skill: SkillRef): Promise<string> =>
  skillDigest(await candidateManifest(skill))

async function status(h: Headless, selector = 'sk'): Promise<StatusDoc> {
  h.out.length = 0
  expect(await h.run(['status', selector, '--json'])).toBe(0)
  return h.json<StatusDoc>()
}

describe('skillgantry status', () => {
  it('reports a skill that has never run: three null gates, the blockers they cause, and the commands that clear them', async () => {
    const h = await makeHeadless()
    const [skill] = await h.skills()
    const doc = await status(h)

    expect(doc.skill).toEqual({
      id: skill!.id,
      name: 'sk',
      repoId: basename(h.repos[0]!),
      dir: skill!.dir,
      repoPath: skill!.repo.path,
      version: '1.0.0',
      deprecated: false,
      digest: await digestOf(skill!),
    })
    expect(String(doc.skill['digest'])).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(doc.gates).toEqual(
      ['validate', 'evaluate', 'security'].map((stage) => ({
        stage,
        outcome: null,
        runId: null,
        runDir: null,
        current: false,
      })),
    )
    expect(doc.hasEvalSuite).toBe(false)
    expect(doc.issues).toEqual({ open: 0, suppressed: 0, bySeverity: [], items: [] })
    expect(doc.release.ready).toBe(false)
    expect(doc.release.blockers.map((b) => b.code)).toEqual([
      'release-tool-missing',
      'gate-missing',
      'gate-missing',
      'gate-missing',
    ])
    expect(doc.release.unchecked).toEqual(['target-version', 'archive', 'sandbox'])
    // The first entry is the missing release tool: no command clears it, and
    // leaving it out would have left a caller with a blocker and no step.
    expect(doc.next.map((n) => n.command)).toEqual([
      null,
      `skillgantry evals ${skill!.id}`,
      `skillgantry run ${skill!.id} --stage validate,evaluate,security`,
    ])
    expect(doc.next[0]?.why).toContain('skillgantry setup')
  })

  it('reports ready, and names release as the only next step, once every gate passed against these bytes', async () => {
    const h = await makeHeadless({
      releaseTool: true,
      repos: [
        {
          'sk/SKILL.md': SKILL_MD_FULL('sk'),
          'sk/evals/eval.yaml': 'engine:\n  name: claude_code\ncases: []\n',
        },
      ],
    })
    const [skill] = await h.skills()
    const ledger = openLedger(h.dbPath)
    const runId = seedGates(ledger, skill!, { digest: await digestOf(skill!) })
    ledger.close()

    const doc = await status(h)

    expect(doc.hasEvalSuite).toBe(true)
    expect(doc.gates.map((g) => [g.stage, g.outcome, g.runId, g.current])).toEqual([
      ['validate', 'passed', runId, true],
      ['evaluate', 'passed', runId, true],
      ['security', 'passed', runId, true],
    ])
    expect(doc.gates[0]?.runDir).toBe(join(skill!.workspacePath, 'skillgantry', 'runs', runId))
    expect(doc.release).toMatchObject({ ready: true, blockers: [], dirty: [] })
    expect(doc.next).toHaveLength(1)
    expect(doc.next[0]?.command).toBe(
      `skillgantry release ${skill!.id} --version <patch|minor|major> --yes`,
    )
  })

  it('marks every gate stale and reports the digest-mismatch blockers after one byte moves', async () => {
    const h = await makeHeadless({ releaseTool: true })
    const [skill] = await h.skills()
    const ledger = openLedger(h.dbPath)
    seedGates(ledger, skill!, { digest: await digestOf(skill!) })
    ledger.close()
    await writeFile(join(skill!.dir, 'SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'the sk skilL'))

    const doc = await status(h)

    expect(doc.gates.map((g) => [g.outcome, g.current])).toEqual([
      ['passed', false],
      ['passed', false],
      ['passed', false],
    ])
    expect(doc.release.ready).toBe(false)
    expect(doc.release.blockers.map((b) => b.code)).toEqual([
      'digest-mismatch',
      'digest-mismatch',
      'digest-mismatch',
    ])
    expect(doc.next.at(-1)?.command).toBe(
      `skillgantry run ${skill!.id} --stage validate,evaluate,security`,
    )
  })

  it('counts open issues the way the dashboard does, suppressed ones beside them', async () => {
    const h = await makeHeadless({ releaseTool: true })
    const [skill] = await h.skills()
    const digest = await digestOf(skill!)
    const ledger = openLedger(h.dbPath)
    recordFixtureRun(ledger, {
      runId: '019000000000-s',
      skill: skill!,
      digest,
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
            {
              ruleClass: 'unsafe-script',
              nativeRuleId: 'MP2',
              severity: 'medium',
              path: 'scripts/scan.py',
              message: 'alignment whitespace',
              suppressed: { justification: 'alignment in a verbose block' },
            },
          ],
        },
      ],
    })
    ledger.close()

    const doc = await status(h)

    expect(doc.issues.open).toBe(1)
    expect(doc.issues.suppressed).toBe(1)
    expect(doc.issues.bySeverity).toEqual([{ severity: 'high', count: 1 }])
    expect(doc.issues.items).toHaveLength(1)
    expect(doc.issues.items[0]).toEqual({
      fingerprint: expect.stringMatching(/\S/),
      severity: 'high',
      ruleClass: 'prompt-injection',
      path: 'SKILL.md',
      state: 'open',
      detectors: ['skillspector'],
    })
    // A failed security gate against the current bytes is a finding to fix, and
    // `--run` names the run that recorded it.
    const fix = doc.next.find((n) => n.command?.includes(' fix '))
    expect(fix?.command).toBe(`skillgantry fix ${skill!.id} --stage security --run 019000000000-s`)
  })

  it('names an interrupted mutation of this skill first, and counts it as a blocker', async () => {
    const h = await makeHeadless({ releaseTool: true })
    const [skill] = await h.skills()
    const recordDir = join(skill!.workspacePath, 'skillgantry', 'runs', 'run-x')
    await mkdir(recordDir, { recursive: true })
    await writeSandboxRecord(recordDir, {
      runId: 'run-x',
      stage: 'optimise',
      strategy: 'snapshot',
      state: 'active',
      scope: ['sk/SKILL.md'],
      repoPath: h.repos[0]!,
      skillId: skill!.id,
      skillRelPath: 'sk',
      rootSkill: false,
      snapshotDir: join(recordDir, 'snapshot-pre'),
      workRoot: h.repos[0]!,
      preimages: [],
      openedAt: '2026-08-03T00:00:00.000Z',
    })

    const doc = await status(h)

    expect(doc.release.blockers.map((b) => b.code)).toContain('interrupted-mutation')
    expect(doc.next[0]?.command).toBe('skillgantry recover')
  })

  it('reads deprecation from the frontmatter and leaves the ledger cache alone', async () => {
    const h = await makeHeadless({ releaseTool: true })
    const [skill] = await h.skills()
    const ledger = openLedger(h.dbPath)
    seedGates(ledger, skill!, { digest: await digestOf(skill!) })
    ledger.close()
    await writeFile(
      join(skill!.dir, 'SKILL.md'),
      '---\nname: sk\ndescription: the sk skill\nmetadata:\n  version: 1.0.0\n  deprecated: true\n---\n\n# sk\n',
    )

    const doc = await status(h)

    expect(doc.skill['deprecated']).toBe(true)
    expect(doc.release.blockers.map((b) => b.code)).toContain('deprecated')
    expect(doc.next.some((n) => n.command === `skillgantry retire ${skill!.id} --undo`)).toBe(true)

    // `syncLifecycle` would have rewritten this row to `deprecated`.
    const after = openLedger(h.dbPath)
    try {
      expect(readLifecycleCache(after.db).get(skill!.id)).toBe('active')
    } finally {
      after.close()
    }
  })

  it('writes nothing to the repo or the sidecar, whether or not the skill has run', async () => {
    const h = await makeHeadless({
      git: true,
      releaseTool: true,
      repos: [{ 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n' }],
    })
    const [skill] = await h.skills()
    const root = h.repos[0]!

    const before = await treeSnapshot(root)
    await status(h)
    expect(await treeSnapshot(root)).toEqual(before)

    const ledger = openLedger(h.dbPath)
    seedGates(ledger, skill!, { digest: await digestOf(skill!) })
    ledger.close()
    await mkdir(workspacePath(root, 'sk', false), { recursive: true })
    const withSidecar = await treeSnapshot(root)
    await status(h)
    expect(await treeSnapshot(root)).toEqual(withSidecar)
  })

  it('exits 0 whether or not the skill is ready, because the code says a document was produced', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status', 'sk', '--json'])).toBe(0)
    expect(h.json<StatusDoc>().release.ready).toBe(false)
  })

  it('rejects an unknown skill', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status', 'nope'])).toBe(2)
    expect(h.err).toEqual(['error: no skill matching "nope"'])
  })

  it('prints a readable summary without --json', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status', 'sk'])).toBe(0)
    const text = h.out.join('\n')
    expect(text).toContain((await h.skills())[0]!.id)
    expect(text).toMatch(/not ready/)
    expect(text).toContain('skillgantry run')
    expect(() => JSON.parse(text)).toThrow()
  })
})
