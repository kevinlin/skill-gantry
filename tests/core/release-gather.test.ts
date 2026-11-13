import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { gatherReleasePreconditions } from '../../src/core/release/gather.js'
import type { ToolLock } from '../../src/core/config/config.js'
import { fakeSkillsBin, seedGates, skillsLockEntry } from '../helpers/release-fixture.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'
import { repoSkillRef } from '../helpers/skill-ref.js'

const MANIFEST = '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n'

async function scene(files: Record<string, string> = { 'versions.json': MANIFEST }) {
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk'), ...files } })
  const skill = repoSkillRef(repo, 'sk')
  const digest = await skillDigest(await candidateManifest(skill))
  const ledger = openLedger(':memory:')
  seedGates(ledger, skill, { digest })
  const lock: ToolLock = {
    version: 1,
    tools: { skills: skillsLockEntry(await fakeSkillsBin()) },
  }
  return { repo, skill, digest, ledger, lock }
}

describe('gatherReleasePreconditions', () => {
  it('refuses nothing for a skill whose gates passed against the current bytes, and returns what it read', async () => {
    const s = await scene()
    const gathered = await gatherReleasePreconditions({
      skill: s.skill,
      db: s.ledger.db,
      lock: s.lock,
      interrupted: false,
    })

    expect(gathered.refusals).toEqual([])
    expect(gathered.evidence?.currentDigest).toBe(s.digest)
    expect(gathered.evidence?.gates.map((g) => g.stage).sort()).toEqual([
      'evaluate',
      'security',
      'validate',
    ])
    expect(gathered.evidence?.manifest?.versions).toEqual({ sk: '1.0.0' })
    expect(gathered.evidence?.candidate.entries.map((e) => e.relPath)).toEqual(['SKILL.md'])
  })

  it('reports no manifest as null evidence rather than a refusal', async () => {
    const s = await scene({})
    const gathered = await gatherReleasePreconditions({
      skill: s.skill,
      db: s.ledger.db,
      lock: s.lock,
      interrupted: false,
    })
    expect(gathered.refusals).toEqual([])
    expect(gathered.evidence?.manifest).toBeNull()
  })

  it('gives every digest-mismatch refusal the message release has always given', async () => {
    const s = await scene()
    await writeFile(join(s.repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'edited'))
    const gathered = await gatherReleasePreconditions({
      skill: s.skill,
      db: s.ledger.db,
      lock: s.lock,
      interrupted: false,
    })

    const mismatches = gathered.refusals.filter((r) => r.code === 'digest-mismatch')
    expect(mismatches.map((r) => r.message)).toEqual(
      ['validate', 'evaluate', 'security'].map(
        (stage) =>
          `${stage} passed against ${s.digest} and the candidate is now ${gathered.evidence?.currentDigest}: ` +
          're-run the gates against these bytes (R9.9)',
      ),
    )
    expect(gathered.evidence?.currentDigest).not.toBe(s.digest)
  })

  it('returns manifest-unreadable alone, with the message the stage always used, and no evidence', async () => {
    const s = await scene({ 'versions.json': '{ not valid json' })
    await writeFile(join(s.repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'edited'))
    const gathered = await gatherReleasePreconditions({
      skill: s.skill,
      db: s.ledger.db,
      lock: s.lock,
      interrupted: true,
    })

    expect(gathered.refusals).toEqual([
      {
        code: 'manifest-unreadable',
        message:
          'versions.json exists but could not be read as the expected {"skills": {...}} shape: ' +
          'fix or remove it before releasing (R9.2)',
      },
    ])
    expect(gathered.evidence).toBeNull()
  })

  it('reports a lock without the installability tool beside every other refusal', async () => {
    const s = await scene()
    await writeFile(join(s.repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'edited'))
    const gathered = await gatherReleasePreconditions({
      skill: s.skill,
      db: s.ledger.db,
      lock: { version: 1, tools: {} },
      interrupted: false,
    })

    const codes = gathered.refusals.map((r) => r.code)
    expect(codes[0]).toBe('release-tool-missing')
    expect(codes).toContain('digest-mismatch')
    expect(gathered.refusals[0]?.message).toContain('skills')
  })

  it('carries the interrupted flag through to the refusal', async () => {
    const s = await scene()
    const gathered = await gatherReleasePreconditions({
      skill: s.skill,
      db: s.ledger.db,
      lock: s.lock,
      interrupted: true,
    })
    expect(gathered.refusals.map((r) => r.code)).toEqual(['interrupted-mutation'])
  })
})
