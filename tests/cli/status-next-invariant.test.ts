import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { writeSandboxRecord } from '../../src/core/isolation/record.js'
import { openLedger } from '../../src/core/ledger/db.js'
import type { GatheredRefusalCode } from '../../src/core/index.js'
import type { SkillRef } from '../../src/core/types.js'
import { type Headless, makeHeadless } from '../helpers/headless.js'
import { type GateOutcomes, seedGates } from '../helpers/release-fixture.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'

interface StatusDoc {
  release: { ready: boolean; blockers: Array<{ code: string; message: string }> }
  next: Array<{ command: string | null; why: string }>
}

const EVALS = 'engine:\n  name: claude_code\ncases: []\n'
const DEPRECATED_SKILL_MD =
  '---\nname: sk\ndescription: the sk skill\nmetadata:\n  version: 1.0.0\n  deprecated: true\n---\n\n# sk\n'

const digestOf = async (skill: SkillRef): Promise<string> =>
  skillDigest(await candidateManifest(skill))

async function seed(h: Headless, skill: SkillRef, outcomes?: GateOutcomes): Promise<void> {
  const ledger = openLedger(h.dbPath)
  try {
    seedGates(ledger, skill, {
      digest: await digestOf(skill),
      ...(outcomes === undefined ? {} : { outcomes }),
    })
  } finally {
    ledger.close()
  }
}

interface Case {
  /** Files the repo starts with, on top of an eval suite so `evals` is never the entry that answers. */
  files?: Record<string, string>
  releaseTool?: boolean
  /** Brings the skill to a state where this code is the only blocker. */
  arrange: (h: Headless, skill: SkillRef) => Promise<void>
}

/**
 * One row per code the gatherer can emit. `satisfies` makes a new code a type
 * error here until it has a row, and the assertion below proves each row
 * produces its code *alone* — because a second blocker's entry would otherwise
 * hide a code that has none.
 */
const CASES = {
  'release-tool-missing': { arrange: (h, skill) => seed(h, skill) },
  'manifest-unreadable': {
    files: { 'versions.json': '{ not json' },
    releaseTool: true,
    arrange: (h, skill) => seed(h, skill),
  },
  deprecated: {
    files: { 'sk/SKILL.md': DEPRECATED_SKILL_MD },
    releaseTool: true,
    arrange: (h, skill) => seed(h, skill),
  },
  'gate-missing': { releaseTool: true, arrange: async () => {} },
  'gate-not-passed': {
    releaseTool: true,
    arrange: (h, skill) => seed(h, skill, { validate: 'failed', evaluate: 'passed', security: 'passed' }),
  },
  'digest-mismatch': {
    releaseTool: true,
    arrange: async (h, skill) => {
      await seed(h, skill)
      await writeFile(join(skill.dir, 'SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'the sk skilL'))
    },
  },
  'version-disagreement': {
    files: { 'versions.json': '{\n  "skills": {\n    "sk": "0.9.0"\n  }\n}\n' },
    releaseTool: true,
    arrange: (h, skill) => seed(h, skill),
  },
  'interrupted-mutation': {
    releaseTool: true,
    arrange: async (h, skill) => {
      await seed(h, skill)
      const recordDir = join(skill.workspacePath, 'skillgantry', 'runs', 'run-x')
      await mkdir(recordDir, { recursive: true })
      await writeSandboxRecord(recordDir, {
        runId: 'run-x',
        stage: 'optimise',
        strategy: 'snapshot',
        state: 'active',
        scope: ['sk/SKILL.md'],
        repoPath: h.repos[0]!,
        skillId: skill.id,
        skillRelPath: 'sk',
        rootSkill: false,
        snapshotDir: join(recordDir, 'snapshot-pre'),
        workRoot: h.repos[0]!,
        preimages: [],
        openedAt: '2026-08-03T00:00:00.000Z',
      })
    },
  },
} satisfies Record<GatheredRefusalCode, Case>

describe('status — a blocked release always has a next step', () => {
  it.each(Object.entries(CASES) as Array<[GatheredRefusalCode, Case]>)(
    'names something to do about %s, with nothing else blocking to hide it',
    async (code, spec) => {
      const h = await makeHeadless({
        releaseTool: spec.releaseTool === true,
        repos: [{ 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'sk/evals/eval.yaml': EVALS, ...spec.files }],
      })
      const [skill] = await h.skills()
      await spec.arrange(h, skill!)

      h.out.length = 0
      expect(await h.run(['status', 'sk', '--json'])).toBe(0)
      const doc = h.json<StatusDoc>()

      expect(new Set(doc.release.blockers.map((blocker) => blocker.code))).toEqual(new Set([code]))
      expect(doc.release.ready).toBe(false)
      expect(doc.next.length).toBeGreaterThan(0)
      expect(doc.next.every((step) => step.why.trim() !== '')).toBe(true)
      expect(doc.next.some((step) => step.command?.includes('release'))).toBe(false)
    },
  )
})
