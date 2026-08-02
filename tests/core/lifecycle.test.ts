import { describe, expect, it } from 'vitest'
import { readLifecycleCache, syncLifecycle } from '../../src/core/ledger/lifecycle.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { discoverSkills, workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

const deprecatedMd = (name: string) =>
  `---\nname: ${name}\ndescription: d\nmetadata:\n  version: 1.0.0\n  deprecated: true\n  superseded_by: repo/other\n---\n\n# ${name}\n`

const record = (ledger: ReturnType<typeof openLedger>, skill: SkillRef) =>
  recordRun(ledger, {
    skill,
    runId: '019000000000-a',
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
    const skill: SkillRef = {
      id: 'repo/dead',
      name: 'dead',
      version: '1.0.0',
      dir: '/repo/dead',
      relPath: 'dead',
      repo: { id: 'repo', path: '/repo', name: 'repo', isGit: false },
      rootSkill: false,
      workspacePath: workspacePath('/repo', 'dead', false),
      deprecated: true,
      supersededBy: 'repo/other',
    }
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

  it('ignores a skill the ledger has never seen rather than inserting a row', () => {
    const ledger = openLedger(':memory:')
    const unknown: SkillRef = {
      id: 'repo/never-run',
      name: 'x',
      version: null,
      dir: '/repo/x',
      relPath: 'x',
      repo: { id: 'repo', path: '/repo', name: 'repo', isGit: false },
      rootSkill: false,
      workspacePath: '/repo/x-workspace',
      deprecated: true,
      supersededBy: null,
    }
    expect(syncLifecycle(ledger.db, [unknown]).reconciled).toBe(0)
    expect(readLifecycleCache(ledger.db).size).toBe(0)
  })
})
