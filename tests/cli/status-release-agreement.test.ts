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
import { treeSnapshot } from '../helpers/tree.js'

const git = promisify(execFile)

interface Status {
  release: {
    ready: boolean
    blockers: Array<{ code: string; message: string }>
    dirty: string[]
    unchecked: string[]
    target?: { requested: string; resolved: string | null }
  }
  next: Array<{ command: string | null; why: string }>
}

/**
 * R12.12's "over the release pipeline rather than over a shared helper": these
 * drive the real `release` command through the pipeline, so a `status` that
 * agreed with `gatherReleasePreconditions` and disagreed with what `release`
 * then does would still fail here.
 */
async function fixture(extra: Record<string, string> = {}): Promise<Headless> {
  const h = await makeHeadless({
    git: true,
    releaseTool: true,
    repos: [
      {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
        ...extra,
      },
    ],
  })
  const [skill] = await h.skills()
  const ledger = openLedger(h.dbPath)
  seedGates(ledger, skill!, { digest: await skillDigest(await candidateManifest(skill!)) })
  ledger.close()
  return h
}

async function statusOf(h: Headless, ...extra: string[]): Promise<Status> {
  h.out.length = 0
  expect(await h.run(['status', 'sk', '--json', ...extra])).toBe(0)
  return h.json<Status>()
}

/** The summary the release stage recorded for its one tool run, from `release --json`. */
function releaseSummary(h: Headless): string | undefined {
  const events = h.out.map(
    (line) => JSON.parse(line) as { type: string; result?: { toolRuns: Array<{ summary: string }> } },
  )
  return events.find((event) => event.type === 'stage:done')?.result?.toolRuns[0]?.summary
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

/**
 * R12.19's claim is that `status --version` decides with the code release runs.
 * These drive the real command through the pipeline, so a `status` that
 * resolved the target one way and a stage that resolved it another would fail
 * here and nowhere else.
 */
describe('status --version and release agree', () => {
  it.each([
    ['patch', '1.0.1'],
    ['minor', '1.1.0'],
    ['1.4.0', '1.4.0'],
  ])('releases exactly where status --version %s said ready, leaving only the sandbox unchecked', async (target, resolved) => {
    const h = await fixture()
    const repo = h.repos[0]!

    const status = await statusOf(h, '--version', target)
    expect(status.release).toMatchObject({
      ready: true,
      blockers: [],
      dirty: [],
      unchecked: ['sandbox'],
      target: { requested: target, resolved },
    })

    h.out.length = 0
    expect(await h.run(['release', 'sk', '--version', target, '--yes'])).toBe(0)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain(resolved)
    expect((await stat(join(repo, `sk_${resolved}.zip`))).size).toBeGreaterThan(0)
    expect(h.err).toEqual([])
  }, 30_000)

  it.each(['1.0.0', '0.9.0'])(
    'calls %s target-invalid where release then refuses it with the same words',
    async (target) => {
      const h = await fixture()
      const repo = h.repos[0]!

      const status = await statusOf(h, '--version', target)
      expect(status.release.ready).toBe(false)
      expect(status.release.blockers.map((b) => b.code)).toEqual(['target-invalid'])
      expect(status.release.target).toEqual({ requested: target, resolved: null })

      h.out.length = 0
      expect(await h.run(['release', 'sk', '--version', target, '--yes', '--json'])).toBe(1)
      expect(releaseSummary(h)).toBe(status.release.blockers[0]?.message)

      // Nothing written: still the old version, and no archive under either name.
      expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
      await expect(stat(join(repo, `sk_${target}.zip`))).rejects.toThrow()
    },
    30_000,
  )

  it('calls a target that is neither a semver nor a bump level target-invalid', async () => {
    const h = await fixture()
    const garbled = await statusOf(h, '--version', 'next')
    expect(garbled.release.blockers.map((b) => b.code)).toEqual(['target-invalid'])
    expect(garbled.release.blockers[0]?.message).toContain('not a semver or a bump level')
  })

  it('lists an archive already in the tree among the uncommitted paths, git-ignored or not, and not among the blockers', async () => {
    const h = await fixture({ '.gitignore': '*.zip\n' })
    const repo = h.repos[0]!
    // What a crashed earlier release leaves: the archive the target names, ignored by the repo.
    await writeFile(join(repo, 'sk_1.0.1.zip'), 'a stray archive')

    const status = await statusOf(h, '--version', 'patch')
    expect(status.release.dirty).toEqual(['sk_1.0.1.zip'])
    // `--allow-dirty` is the user's call, so it is reported and is not a refusal.
    expect(status.release).toMatchObject({ ready: true, blockers: [], unchecked: ['sandbox'] })
    expect(status.next[0]?.why).toContain('sk_1.0.1.zip')

    // The sandbox refuses it, as status said it would.
    h.out.length = 0
    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes', '--json'])).toBe(1)
    expect(h.out.join('\n')).toContain('sk_1.0.1.zip')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')

    // Without a target there is no archive name to look for: the document is R12.12's.
    const versionless = await statusOf(h)
    expect(versionless.release.dirty).toEqual([])
    expect(versionless.release.unchecked).toEqual(['target-version', 'archive', 'sandbox'])
  }, 30_000)

  it('does not list an archive the target does not name', async () => {
    const h = await fixture({ '.gitignore': '*.zip\n' })
    await writeFile(join(h.repos[0]!, 'sk_1.0.1.zip'), 'a stray archive')

    const status = await statusOf(h, '--version', 'minor')

    expect(status.release.dirty).toEqual([])
  })

  it('writes nothing to the repo or the sidecar under --version, archive present or not', async () => {
    const h = await fixture({ '.gitignore': '*.zip\n' })
    const repo = h.repos[0]!
    await writeFile(join(repo, 'sk_1.0.1.zip'), 'a stray archive')

    const before = await treeSnapshot(repo)
    await statusOf(h, '--version', 'patch')
    await statusOf(h, '--version', '1.0.0')
    expect(await treeSnapshot(repo)).toEqual(before)
  })

  it('names the resolved version, not the bump level, in the release entry of next', async () => {
    const h = await fixture()
    const [skill] = await h.skills()

    const status = await statusOf(h, '--version', 'minor')

    expect(status.next.map((step) => step.command)).toEqual([
      `skillgantry release ${skill!.id} --version 1.1.0 --yes`,
    ])
  })
})
