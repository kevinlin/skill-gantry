import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { type Headless, makeHeadless } from '../helpers/headless.js'
import { seedGates } from '../helpers/release-fixture.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'

const git = promisify(execFile)

interface Status {
  release: { ready: boolean; blockers: Array<{ code: string; message: string }>; dirty: string[] }
}

/**
 * R12.12's "over the release pipeline rather than over a shared helper": these
 * drive the real `release` command through the pipeline, so a `status` that
 * agreed with `gatherReleasePreconditions` and disagreed with what `release`
 * then does would still fail here.
 */
async function fixture(): Promise<Headless> {
  const h = await makeHeadless({
    git: true,
    releaseTool: true,
    repos: [
      {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    ],
  })
  const [skill] = await h.skills()
  const ledger = openLedger(h.dbPath)
  seedGates(ledger, skill!, { digest: await skillDigest(await candidateManifest(skill!)) })
  ledger.close()
  return h
}

async function statusOf(h: Headless): Promise<Status> {
  h.out.length = 0
  expect(await h.run(['status', 'sk', '--json'])).toBe(0)
  return h.json<Status>()
}

describe('status and release agree', () => {
  it('releases exactly where status said ready', async () => {
    const h = await fixture()
    const repo = h.repos[0]!

    const status = await statusOf(h)
    expect(status.release).toMatchObject({ ready: true, blockers: [], dirty: [] })

    h.out.length = 0
    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes'])).toBe(0)

    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.1')
    expect((await stat(join(repo, 'sk_1.0.1.zip'))).size).toBeGreaterThan(0)
    expect(h.err).toEqual([])
  }, 30_000)

  it('refuses with every blocker status named once one byte has changed', async () => {
    const h = await fixture()
    const repo = h.repos[0]!
    // One character of the description: the gates ran against the other bytes.
    await writeFile(join(repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'the sk skilL'))

    const status = await statusOf(h)
    expect(status.release.ready).toBe(false)
    expect(status.release.blockers.map((b) => b.code)).toEqual([
      'digest-mismatch',
      'digest-mismatch',
      'digest-mismatch',
    ])
    // Reported, and not a blocker: `--allow-dirty` is the user's call.
    expect(status.release.dirty).toEqual(['sk/SKILL.md'])

    h.out.length = 0
    expect(
      await h.run(['release', 'sk', '--version', 'patch', '--yes', '--allow-dirty', '--json']),
    ).toBe(1)

    const events = h.out.map((line) => JSON.parse(line) as { type: string; result?: { toolRuns: Array<{ summary: string }> } })
    const stageDone = events.find((event) => event.type === 'stage:done')
    const summary = stageDone?.result?.toolRuns[0]?.summary ?? ''
    for (const blocker of status.release.blockers) expect(summary).toContain(blocker.message)
    expect(summary).toBe(status.release.blockers.map((b) => b.message).join('; '))

    // Nothing written: the edited, un-bumped file and no archive.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('skilL')
    await expect(stat(join(repo, 'sk_1.0.1.zip'))).rejects.toThrow()
  }, 30_000)

  it('refuses where status named a version disagreement', async () => {
    const h = await fixture()
    const repo = h.repos[0]!
    await writeFile(join(repo, 'versions.json'), '{\n  "skills": {\n    "sk": "0.9.0"\n  }\n}\n')

    const status = await statusOf(h)
    expect(status.release.blockers.map((b) => b.code)).toEqual(['version-disagreement'])

    h.out.length = 0
    expect(
      await h.run(['release', 'sk', '--version', 'patch', '--yes', '--allow-dirty', '--json']),
    ).toBe(1)
    const events = h.out.map((line) => JSON.parse(line) as { type: string; result?: { toolRuns: Array<{ summary: string }> } })
    const summary = events.find((event) => event.type === 'stage:done')?.result?.toolRuns[0]?.summary
    expect(summary).toBe(status.release.blockers[0]?.message)
  }, 30_000)

  it('reports an unreadable versions.json alone, the way release refuses it', async () => {
    const h = await fixture()
    const repo = h.repos[0]!
    // Committed, so the release's sandbox — a worktree at HEAD — holds the same
    // bytes the live tree does. `versions.json` is outside the release scope
    // while it is unreadable, so an uncommitted corruption never reaches it.
    await writeFile(join(repo, 'versions.json'), '{ not json')
    await git('git', ['commit', '-qam', 'corrupt the manifest'], { cwd: repo })

    const status = await statusOf(h)
    expect(status.release.blockers.map((b) => b.code)).toEqual(['manifest-unreadable'])
    expect(status.release.dirty).toEqual([])

    h.out.length = 0
    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes', '--json'])).toBe(1)
    const events = h.out.map((line) => JSON.parse(line) as { type: string; result?: { toolRuns: Array<{ summary: string }> } })
    const summary = events.find((event) => event.type === 'stage:done')?.result?.toolRuns[0]?.summary
    expect(summary).toBe(status.release.blockers[0]?.message)
  }, 30_000)
})
