import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface RepoSpec {
  /** Relative path -> file contents. Directories are created as needed. */
  files: Record<string, string>
}

export async function makeRepo(spec: RepoSpec): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillgantry-'))
  for (const [rel, contents] of Object.entries(spec.files)) {
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents)
  }
  return root
}

export const SKILL_MD = (name: string, version = '1.0.0'): string =>
  `---\nname: ${name}\nmetadata:\n  version: ${version}\n---\n\n# ${name}\n`

/**
 * A committed repo, because a worktree starts at HEAD: `git worktree add HEAD`
 * against a repo with no commit fails with an unhelpful invalid-reference error.
 */
export async function makeGitRepo(spec: RepoSpec): Promise<string> {
  const root = await makeRepo(spec)
  await run('git', ['init', '-q', '.'], { cwd: root })
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
  await run('git', ['config', 'user.name', 'test'], { cwd: root })
  await run('git', ['add', '-A'], { cwd: root })
  await run('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

/**
 * `SKILL_MD` with a description, which vercel `skills` requires before it will
 * install a directory — so every release fixture needs one. `SKILL_MD` itself is
 * left alone: adding a line to it changes the bytes every existing digest and
 * fingerprint test is built on.
 */
export const SKILL_MD_FULL = (
  name: string,
  version = '1.0.0',
  description = `the ${name} skill`,
): string =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  version: ${version}\n---\n\n# ${name}\n`
