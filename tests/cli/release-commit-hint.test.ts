import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { type Exec, commitHint } from '../../src/core/index.js'
import { type Headless, makeHeadless } from '../helpers/headless.js'
import { seedGates } from '../helpers/release-fixture.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'

const run = promisify(execFile)
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd })

const MANIFEST = '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n'

/** A skill whose three gates passed against its current bytes, ready for `release --version patch`. */
async function scene(spec: { git: boolean; files?: Record<string, string> }): Promise<{ h: Headless; repo: string }> {
  const h = await makeHeadless({
    git: spec.git,
    releaseTool: true,
    repos: [{ 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'versions.json': MANIFEST, ...spec.files }],
  })
  const [skill] = await h.skills()
  const ledger = openLedger(h.dbPath)
  seedGates(ledger, skill!, { digest: await skillDigest(await candidateManifest(skill!)) })
  ledger.close()
  return { h, repo: skill!.repo.path }
}

/** Every line after `released …`, which is where the hint goes. */
const afterReleased = (out: readonly string[]): string[] => {
  const at = out.findIndex((line) => line.startsWith('released '))
  return at === -1 ? [] : out.slice(at + 1)
}

describe('release prints the commit it leaves to you', () => {
  it('names the add and the commit after `released`, over the paths it changed, and runs neither', async () => {
    const { h, repo } = await scene({ git: true })

    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes'])).toBe(0)

    expect(afterReleased(h.out)).toEqual(
      commitHint({
        repo,
        name: 'sk',
        version: '1.0.1',
        paths: ['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk_1.0.1.zip', 'versions.json'],
      }),
    )
    // R9.7: named, never run.
    const { stdout } = await git(repo, 'log', '-1', '--format=%s')
    expect(stdout.trim()).toBe('fixture')
  }, 30_000)

  it('resolves a bump level to the version it names in the message', async () => {
    const { h } = await scene({ git: true })

    expect(await h.run(['release', 'sk', '--version', 'minor', '--yes'])).toBe(0)

    expect(afterReleased(h.out)[1]).toContain("-m 'release(sk): 1.1.0'")
  }, 30_000)

  it('leaves out an archive the repo ignores, which a git add would refuse', async () => {
    const { h, repo } = await scene({ git: true, files: { '.gitignore': '*.zip\n' } })

    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes'])).toBe(0)

    const lines = afterReleased(h.out)
    expect(lines).toEqual(
      commitHint({
        repo,
        name: 'sk',
        version: '1.0.1',
        paths: ['sk/CHANGELOG.md', 'sk/SKILL.md', 'versions.json'],
      }),
    )
    expect(lines.join('\n')).not.toContain('.zip')
  }, 30_000)

  it('prints nothing for a repo that is not git-backed', async () => {
    const { h } = await scene({ git: false })

    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes'])).toBe(0)

    expect(afterReleased(h.out)).toEqual([])
    expect(h.out.join('\n')).not.toContain('git -C')
  }, 30_000)

  it('prints nothing under --json, where every line is an event a caller parses', async () => {
    const { h } = await scene({ git: true })

    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes', '--json'])).toBe(0)

    for (const line of h.out) expect(() => JSON.parse(line)).not.toThrow()
    expect(h.out.join('\n')).not.toContain('git -C')
  }, 30_000)

  it('prints nothing when nothing was applied', async () => {
    const { h } = await scene({ git: true })

    // Without --yes the stage is skipped: no write, so nothing to commit.
    expect(await h.run(['release', 'sk', '--version', 'patch'])).toBe(1)
    expect(h.out.join('\n')).not.toContain('git -C')

    h.out.length = 0
    // A target that does not resolve is refused before anything is staged.
    expect(await h.run(['release', 'sk', '--version', '1.0.0', '--yes'])).toBe(1)
    expect(h.out.join('\n')).not.toContain('git -C')
  }, 30_000)

  it('asks git through the injected Exec, once, in the repo, so a test never depends on the host git', async () => {
    const { h, repo } = await scene({ git: true })
    const calls: Array<{ bin: string; argv: string[]; cwd: string | undefined }> = []
    const exec: Exec = async (bin, argv, options) => {
      calls.push({ bin, argv: [...argv], cwd: options?.cwd })
      // Only the archive is reported changed: the filter's answer is the hint's paths.
      return { stdout: '?? sk_1.0.1.zip\0', stderr: '' }
    }

    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes'], { exec })).toBe(0)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ bin: 'git', cwd: repo })
    expect(calls[0]?.argv.slice(0, 2)).toEqual(['status', '--porcelain=v1'])
    expect(afterReleased(h.out)).toEqual(
      commitHint({ repo, name: 'sk', version: '1.0.1', paths: ['sk_1.0.1.zip'] }),
    )
  }, 30_000)

  it('does not ask git for a hint at all in a repo that is not git-backed', async () => {
    const { h } = await scene({ git: false })
    const calls: string[] = []
    const exec: Exec = async (bin) => {
      calls.push(bin)
      return { stdout: '', stderr: '' }
    }

    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes'], { exec })).toBe(0)

    expect(calls).toEqual([])
  }, 30_000)

  it('commits the release paths and nothing else when run over a tree with other work staged', async () => {
    const { h, repo } = await scene({ git: true, files: { 'notes.txt': 'before\n' } })
    // The tree a release is permitted over: someone else's change, staged and
    // outside the release scope, so R10.3's dirty check does not see it.
    await writeFile(join(repo, 'notes.txt'), 'staged by someone else\n')
    await git(repo, 'add', 'notes.txt')

    expect(await h.run(['release', 'sk', '--version', 'patch', '--yes'])).toBe(0)
    const lines = afterReleased(h.out)
    expect(lines).toHaveLength(2)

    const elsewhere = await mkdtemp(join(tmpdir(), 'sg-elsewhere-'))
    for (const line of lines) await run('sh', ['-c', line], { cwd: elsewhere })

    const { stdout: committed } = await git(repo, 'show', '--name-only', '--format=%s', 'HEAD')
    const [subject, ...files] = committed.split('\n').filter((line) => line !== '')
    expect(subject).toBe('release(sk): 1.0.1')
    expect(files.sort()).toEqual(['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk_1.0.1.zip', 'versions.json'])

    // The other work is exactly as it was: staged, with its own content, uncommitted.
    const { stdout: staged } = await git(repo, 'diff', '--cached', '--name-only')
    expect(staged.trim().split('\n')).toEqual(['notes.txt'])
    const { stdout: stagedBytes } = await git(repo, 'show', ':notes.txt')
    expect(stagedBytes).toBe('staged by someone else\n')
  }, 30_000)
})
