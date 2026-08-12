import { describe, expect, it } from 'vitest'
import { readLifecycleCache, syncLifecycle } from '../../src/core/ledger/lifecycle.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'
import { repoSkillRef } from '../helpers/skill-ref.js'

const deprecatedMd = (name: string) =>
  `---\nname: ${name}\ndescription: d\nmetadata:\n  version: 1.0.0\n  deprecated: true\n  superseded_by: repo/other\n---\n\n# ${name}\n`

let runSeq = 0
const record = (ledger: ReturnType<typeof openLedger>, skill: SkillRef) =>
  recordRun(ledger, {
    skill,
    runId: `019000000000-${(runSeq++).toString(36)}`,
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: 'sha256:x',
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: '/s',
    stages: [{ stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [] }],
  })

const deprecatedAt = (ledger: ReturnType<typeof openLedger>, skillId: string): string | null =>
  (
    ledger.db.prepare('select deprecated_at from skills where id = ?').get(skillId) as {
      deprecated_at: string | null
    }
  ).deprecated_at

describe('lifecycle authority', () => {
  it('discovery reads deprecation from frontmatter', async () => {
    const repo = await makeRepo({
      files: { 'live/SKILL.md': SKILL_MD_FULL('live'), 'dead/SKILL.md': deprecatedMd('dead') },
    })
    const skills = await discoverSkills({ id: 'repo', path: repo, name: 'repo', isGit: false })
    const byId = new Map(skills.map((s) => [s.id, s]))
    expect(byId.get('repo/live')?.deprecated).toBe(false)
    expect(byId.get('repo/dead')?.deprecated).toBe(true)
    expect(byId.get('repo/dead')?.supersededBy).toBe('repo/other')
  })

  it('records the lifecycle state a run observed rather than a hard-coded active', async () => {
    const ledger = openLedger(':memory:')
    const skill = repoSkillRef('/repo', 'dead', {
      deprecated: true,
      supersededBy: 'repo/other',
    })
    record(ledger, skill)
    expect(readLifecycleCache(ledger.db).get('repo/dead')).toBe('deprecated')
  })

  it('reconciles a stale cache to the file, in both directions', async () => {
    const ledger = openLedger(':memory:')
    const repo = await makeRepo({ files: { 'dead/SKILL.md': deprecatedMd('dead') } })
    const skills = await discoverSkills({ id: 'repo', path: repo, name: 'repo', isGit: false })
    const skill = skills[0] as SkillRef
    // A run recorded before the deprecation, so the cache says active.
    record(ledger, { ...skill, deprecated: false, supersededBy: null })
    expect(readLifecycleCache(ledger.db).get(skill.id)).toBe('active')

    expect(syncLifecycle(ledger.db, skills).reconciled).toBe(1)
    expect(readLifecycleCache(ledger.db).get(skill.id)).toBe('deprecated')
    // Idempotent: a second scan reconciles nothing.
    expect(syncLifecycle(ledger.db, skills).reconciled).toBe(0)

    // Reversal is one file write, and the ledger follows on the next scan.
    const revived = [{ ...skill, deprecated: false, supersededBy: null }]
    expect(syncLifecycle(ledger.db, revived).reconciled).toBe(1)
    expect(readLifecycleCache(ledger.db).get(skill.id)).toBe('active')
  })

  it('stamps deprecated_at on a later run that observes deprecation, holds it steady, then clears it on revival', () => {
    const ledger = openLedger(':memory:')
    const skill = repoSkillRef('/repo')
    // Inserted while active: no stamp.
    record(ledger, skill)
    expect(deprecatedAt(ledger, skill.id)).toBeNull()

    // A later run observes deprecation through the same upsert path (the
    // ON CONFLICT branch, not the INSERT branch) — this is what record.ts's
    // conflict clause has to stamp, mirroring syncLifecycle's own transition.
    record(ledger, { ...skill, deprecated: true, supersededBy: 'repo/other' })
    const firstStamp = deprecatedAt(ledger, skill.id)
    expect(firstStamp).not.toBeNull()

    // A second run that still finds it deprecated must not restamp.
    record(ledger, { ...skill, deprecated: true, supersededBy: 'repo/other' })
    expect(deprecatedAt(ledger, skill.id)).toBe(firstStamp)

    // Revival clears the stamp.
    record(ledger, { ...skill, deprecated: false, supersededBy: null })
    expect(deprecatedAt(ledger, skill.id)).toBeNull()
  })

  it('ignores a skill the ledger has never seen rather than inserting a row', () => {
    const ledger = openLedger(':memory:')
    const unknown = repoSkillRef('/repo', 'x', {
      id: 'repo/never-run',
      version: null,
      deprecated: true,
    })
    expect(syncLifecycle(ledger.db, [unknown]).reconciled).toBe(0)
    expect(readLifecycleCache(ledger.db).size).toBe(0)
  })
})
