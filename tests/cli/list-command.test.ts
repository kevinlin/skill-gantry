import { describe, expect, it } from 'vitest'
import { basename } from 'node:path'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { makeHeadless } from '../helpers/headless.js'
import { recordFixtureRun } from '../helpers/ledger-fixture.js'
import { seedGates } from '../helpers/release-fixture.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'
import { treeSnapshot } from '../helpers/tree.js'

interface ListDoc {
  skills: Array<{
    id: string
    name: string
    repoId: string
    dir: string
    version: string | null
    deprecated: boolean
    gates: { validate: string | null; evaluate: string | null; security: string | null }
    openIssues: number
  }>
}

describe('skillgantry list', () => {
  it('lists a skill that has never run with null gates and no issues', async () => {
    const h = await makeHeadless()
    expect(await h.run(['list', '--json'])).toBe(0)
    const [skill] = await h.skills()

    expect(h.json<ListDoc>()).toEqual({
      skills: [
        {
          id: skill!.id,
          name: 'sk',
          repoId: basename(h.repos[0]!),
          dir: skill!.dir,
          version: '1.0.0',
          deprecated: false,
          gates: { validate: null, evaluate: null, security: null },
          openIssues: 0,
        },
      ],
    })
  })

  it('lists two repos that share a skill name under their own ids', async () => {
    const h = await makeHeadless({
      repos: [{ 'dup/SKILL.md': SKILL_MD_FULL('dup') }, { 'dup/SKILL.md': SKILL_MD_FULL('dup', '2.0.0') }],
    })
    expect(await h.run(['list', '--json'])).toBe(0)

    const { skills } = h.json<ListDoc>()
    expect(skills).toHaveLength(2)
    expect(skills.map((s) => s.name)).toEqual(['dup', 'dup'])
    expect(new Set(skills.map((s) => s.id)).size).toBe(2)
    expect(new Set(skills.map((s) => s.repoId)).size).toBe(2)
    expect(skills.map((s) => s.id)).toEqual(h.repos.map((r) => `${basename(r)}/dup`))
    expect(skills.map((s) => s.version)).toEqual(['1.0.0', '2.0.0'])
  })

  it('reports each gate as last recorded, and the open issues, without computing a digest', async () => {
    const h = await makeHeadless()
    const [skill] = await h.skills()
    const ledger = openLedger(h.dbPath)
    // Recorded against bytes that are not the current ones: `list` says what
    // the ledger holds and leaves "does it still hold" to `status`.
    seedGates(ledger, skill!, { digest: 'sha256:some-other-bytes', outcomes: { validate: 'passed', security: 'degraded' } })
    recordFixtureRun(ledger, {
      runId: '019000000000-z',
      skill: skill!,
      digest: await skillDigest(await candidateManifest(skill!)),
      stages: [
        {
          stage: 'security',
          outcome: 'failed',
          findings: [
            { ruleClass: 'prompt-injection', nativeRuleId: 'P2', severity: 'high', path: 'SKILL.md', message: 'a' },
            { ruleClass: 'unsafe-script', nativeRuleId: 'MP2', severity: 'low', path: 'run.sh', message: 'b' },
          ],
        },
      ],
    })
    ledger.close()

    expect(await h.run(['list', '--json'])).toBe(0)
    const [row] = h.json<ListDoc>().skills
    expect(row?.gates).toEqual({ validate: 'passed', evaluate: null, security: 'failed' })
    expect(row?.openIssues).toBe(2)
  })

  it('reports deprecation from the frontmatter', async () => {
    const h = await makeHeadless({
      repos: [
        {
          'old/SKILL.md':
            '---\nname: old\ndescription: gone\nmetadata:\n  version: 0.1.0\n  deprecated: true\n---\n\n# old\n',
        },
      ],
    })
    expect(await h.run(['list', '--json'])).toBe(0)
    expect(h.json<ListDoc>().skills[0]?.deprecated).toBe(true)
  })

  it('prints an empty document when no repo is registered', async () => {
    const h = await makeHeadless({ repos: [] })
    expect(await h.run(['list', '--json'])).toBe(0)
    expect(h.json<ListDoc>()).toEqual({ skills: [] })
  })

  it('prints one readable row per skill without --json', async () => {
    const h = await makeHeadless({
      repos: [{ 'a/SKILL.md': SKILL_MD_FULL('a') }, { 'b/SKILL.md': SKILL_MD_FULL('b') }],
    })
    expect(await h.run(['list'])).toBe(0)
    expect(h.out).toHaveLength(2)
    expect(h.out[0]).toContain(`${basename(h.repos[0]!)}/a`)
    expect(h.out[1]).toContain(`${basename(h.repos[1]!)}/b`)
  })

  it('points at repo add when there is nothing to list', async () => {
    const h = await makeHeadless({ repos: [] })
    expect(await h.run(['list'])).toBe(0)
    expect(h.out.join('\n')).toContain('skillgantry repo add')
  })

  it('writes nothing to a repo or its sidecar', async () => {
    const h = await makeHeadless({ git: true })
    const before = await treeSnapshot(h.repos[0]!)
    expect(await h.run(['list', '--json'])).toBe(0)
    expect(await treeSnapshot(h.repos[0]!)).toEqual(before)
  })
})
