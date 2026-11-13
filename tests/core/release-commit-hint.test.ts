import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { commitHint, gitChangedPaths } from '../../src/core/index.js'
import type { Exec } from '../../src/core/index.js'
import { makeGitRepo } from '../helpers/tmp-repo.js'

const run = promisify(execFile)

const RELEASE_PATHS = ['sk/SKILL.md', 'sk/CHANGELOG.md', 'sk_1.0.1.zip', 'versions.json']

/**
 * The words a real shell makes of `line`, found by letting `sh` parse it with
 * `git` defined as a function that reports its arguments. Asserting on the
 * string would only restate the implementation; this asserts on what a person
 * pasting the line gets.
 */
async function argvOf(line: string): Promise<string[]> {
  const { stdout } = await run('sh', ['-c', `git() { printf '%s\\0' "$@"; }\n${line}`])
  return stdout.split('\0').slice(0, -1)
}

/** Writes `files` under `root`, creating directories. */
async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true })
    await writeFile(join(root, rel), text)
  }
}

const git = (cwd: string, ...args: string[]) => run('git', args, { cwd })

describe('commitHint', () => {
  it('names the add and the commit, both carrying the paths', () => {
    expect(
      commitHint({ repo: '/tmp/repo', name: 'sk', version: '1.0.1', paths: RELEASE_PATHS }),
    ).toEqual([
      'git -C /tmp/repo add -- sk/SKILL.md sk/CHANGELOG.md sk_1.0.1.zip versions.json',
      "git -C /tmp/repo commit -m 'release(sk): 1.0.1' -- sk/SKILL.md sk/CHANGELOG.md sk_1.0.1.zip versions.json",
    ])
  })

  it('says nothing for no paths, since a commit with no pathspec takes everything staged', () => {
    // The failure the pathspec exists to prevent, reached by giving it nothing:
    // `git commit -m …` alone commits the whole index.
    expect(commitHint({ repo: '/tmp/repo', name: 'sk', version: '1.0.1', paths: [] })).toEqual([])
  })

  it('quotes the repo, every path and the message so a shell reads each as one word', async () => {
    const repo = "/tmp/my repo/it's here"
    const paths = [
      'my skill/SKILL.md',
      "it's/CHANGELOG.md",
      '$HOME/x',
      'a;b.zip',
      '-dash.md',
      'star*.md',
      'bang!.md',
      'tick`.md',
      'dq".md',
      'back\\slash.md',
      'new\nline.md',
      'ünï.md',
    ]
    const name = `it's "a" $skill`
    const [add, commit] = commitHint({ repo, name, version: '2.0.0-rc.1', paths })

    expect(await argvOf(add as string)).toEqual(['-C', repo, 'add', '--', ...paths])
    expect(await argvOf(commit as string)).toEqual([
      '-C',
      repo,
      'commit',
      '-m',
      `release(${name}): 2.0.0-rc.1`,
      '--',
      ...paths,
    ])
  })

  it('quotes the two characters zsh expands at the start of a word, which are safe in the middle of one in bash', () => {
    const [add] = commitHint({ repo: '/tmp/r', name: 'sk', version: '1.0.1', paths: ['=rc', '~me', 'a=b'] })
    expect(add).toBe("git -C /tmp/r add -- '=rc' '~me' 'a=b'")
  })

  it('leaves a word alone when nothing in it needs quoting', () => {
    const [add] = commitHint({ repo: '/tmp/r', name: 'sk', version: '1.0.1', paths: ['a-b_c.d/e,f+g:h@i%j'] })
    expect(add).toBe('git -C /tmp/r add -- a-b_c.d/e,f+g:h@i%j')
  })

  it('commits the release paths alone and leaves other staged work staged', async () => {
    const repo = await makeGitRepo({
      files: {
        'my skill/SKILL.md': '---\nname: sk\n---\n',
        "my skill/it's CHANGELOG.md": '# changes\n',
        'versions.json': '{}\n',
        'unrelated.txt': 'before\n',
      },
    })
    // A tree the release is permitted over: someone else's work, staged.
    await write(repo, { 'unrelated.txt': 'staged by someone else\n' })
    await git(repo, 'add', 'unrelated.txt')
    // What a release leaves: two edited files and a new archive.
    await write(repo, {
      'my skill/SKILL.md': '---\nname: sk\nmetadata:\n  version: 1.0.1\n---\n',
      "my skill/it's CHANGELOG.md": '## 1.0.1\n# changes\n',
      'my skill_1.0.1.zip': 'zip bytes',
    })
    const paths = ['my skill/SKILL.md', "my skill/it's CHANGELOG.md", 'my skill_1.0.1.zip']

    const lines = commitHint({ repo, name: 'my skill', version: '1.0.1', paths })
    expect(lines).toHaveLength(2)
    // From somewhere else entirely: `-C` is what points the line at the repo.
    const elsewhere = await mkdtemp(join(tmpdir(), 'sg-elsewhere-'))
    for (const line of lines) await run('sh', ['-c', line], { cwd: elsewhere })

    const { stdout: committed } = await git(repo, 'show', '--name-only', '--format=%s', 'HEAD')
    const [subject, ...files] = committed.split('\n').filter((line) => line !== '')
    expect(subject).toBe('release(my skill): 1.0.1')
    expect(files.sort()).toEqual([...paths].sort())
    const { stdout: stillStaged } = await git(repo, 'diff', '--cached', '--name-only')
    expect(stillStaged.trim().split('\n')).toEqual(['unrelated.txt'])
  })
})

describe('gitChangedPaths', () => {
  const repo = '/tmp/repo'

  const recording = (stdout: string): { exec: Exec; calls: Array<{ bin: string; argv: string[]; cwd?: string }> } => {
    const calls: Array<{ bin: string; argv: string[]; cwd?: string }> = []
    const exec: Exec = async (bin, argv, options) => {
      calls.push({ bin, argv: [...argv], ...(options?.cwd === undefined ? {} : { cwd: options.cwd }) })
      return { stdout, stderr: '' }
    }
    return { exec, calls }
  }

  it('asks git once, in the repo, about exactly the paths it was given', async () => {
    const { exec, calls } = recording('')

    await gitChangedPaths(repo, ['sk/SKILL.md', 'sk_1.0.1.zip'], exec)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.bin).toBe('git')
    expect(calls[0]?.cwd).toBe(repo)
    expect(calls[0]?.argv.slice(0, 2)).toEqual(['status', '--porcelain=v1'])
    // Ignored files are left out of the report on purpose: that is what drops an archive the repo ignores.
    expect(calls[0]?.argv).not.toContain('--ignored')
    expect(calls[0]?.argv.slice(calls[0]!.argv.indexOf('--'))).toEqual(['--', 'sk/SKILL.md', 'sk_1.0.1.zip'])
  })

  it('keeps the paths git reports, in the order given, and drops the rest', async () => {
    const { exec } = recording(' M sk/SKILL.md\0?? sk_1.0.1.zip\0 M elsewhere.md\0')

    expect(
      await gitChangedPaths(repo, ['sk_1.0.1.zip', 'sk/CHANGELOG.md', 'sk/SKILL.md'], exec),
    ).toEqual(['sk_1.0.1.zip', 'sk/SKILL.md'])
  })

  it('reads a rename as changing both its paths', async () => {
    // `status -z` puts the new path first and the old one in the next field.
    const { exec } = recording('R  new.md\0old.md\0')

    expect(await gitChangedPaths(repo, ['old.md', 'new.md', 'other.md'], exec)).toEqual(['old.md', 'new.md'])
  })

  it('does not ask git at all about no paths', async () => {
    const { exec, calls } = recording('?? everything\0')

    expect(await gitChangedPaths(repo, [], exec)).toEqual([])
    expect(calls).toEqual([])
  })

  it('against a real repo, reports edits and new files and leaves out an ignored archive and untouched files', async () => {
    const root = await makeGitRepo({
      files: {
        '.gitignore': '*.zip\n',
        'sk/SKILL.md': 'one\n',
        'sk/CHANGELOG.md': 'log\n',
      },
    })
    await write(root, { 'sk/SKILL.md': 'two\n', 'sk_1.0.1.zip': 'ignored by .gitignore', 'notes.md': 'new\n' })

    expect(
      await gitChangedPaths(root, ['sk/SKILL.md', 'sk/CHANGELOG.md', 'sk_1.0.1.zip', 'notes.md']),
    ).toEqual(['sk/SKILL.md', 'notes.md'])
  })

  it('names a new file inside a directory git has never seen, not the directory', async () => {
    const root = await makeGitRepo({ files: { 'keep.md': 'x\n' } })
    await write(root, { 'fresh/SKILL.md': 'new\n', 'fresh/CHANGELOG.md': 'new\n' })

    expect(await gitChangedPaths(root, ['fresh/SKILL.md', 'fresh/CHANGELOG.md'])).toEqual([
      'fresh/SKILL.md',
      'fresh/CHANGELOG.md',
    ])
  })
})
