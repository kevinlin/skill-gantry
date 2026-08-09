import { lstat, mkdir, readlink, rm, stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitSkillSpec } from './catalogue.js'
import type { Exec } from './exec.js'

/**
 * Upstream's documented runtime table, plus `.agents` which this project's
 * reference machine uses. Probed in order; every existing one is a link target,
 * because a maintainer running two runtimes wants the bundle in both.
 */
export const RUNTIME_SKILL_DIRS: readonly string[] = [
  '.claude',
  '.codex',
  '.openclaw',
  '.hermes',
  '.lighthouse',
  '.kimi',
  '.agents',
]

export interface GitSkillInstall {
  bin: string
  /** Absolute paths of the symlinks created, so uninstall removes exactly them. */
  links: string[]
  sha: string
}

/** Resolves through symlinks: a dangling link is not a directory that holds anything. */
const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Does not resolve, unlike `exists`. A dangling symlink still occupies the name,
 * so `symlink()` over it throws `EEXIST` — checking through `stat` would skip it
 * and turn a link we could have replaced into a failed install.
 */
const occupied = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Per directory, not global: a machine holding the bundle in `~/.claude/skills`
 * and nothing in `~/.agents/skills` needs links in the second without the first
 * being touched. Answering this globally is what would leave one runtime short.
 */
export async function detectSkillDirs(
  home: string,
  spec: GitSkillSpec,
): Promise<{ dir: string; holds: boolean }[]> {
  const found: { dir: string; holds: boolean }[] = []
  const probe = spec.skills[0] ?? 'skillhone'
  for (const runtime of RUNTIME_SKILL_DIRS) {
    const dir = join(home, runtime, 'skills')
    if (!(await exists(dir))) continue
    found.push({ dir, holds: await exists(join(dir, probe, 'SKILL.md')) })
  }
  return found
}

const repoUrl = (repo: string): string => `https://github.com/${repo}.git`

export async function gitSkillInstall(
  dir: string,
  spec: GitSkillSpec & { id: string },
  exec: Exec,
  userHome: string,
): Promise<GitSkillInstall> {
  const repoDir = join(dir, 'repo')
  const venv = join(dir, '.venv')
  const interpreter = join(venv, 'bin', 'python')

  const targets = (await detectSkillDirs(userHome, spec)).filter((entry) => !entry.holds)

  // Refused before the clone: a dozen megabytes fetched and then rejected is a
  // worse first run than a refusal that costs nothing.
  for (const target of targets) {
    for (const name of spec.skills) {
      const link = join(target.dir, name)
      if (!(await occupied(link))) continue
      let current: string | null = null
      try {
        current = (await lstat(link)).isSymbolicLink() ? await readlink(link) : null
      } catch {
        current = null
      }
      if (current === null || !current.startsWith(dir)) {
        throw new Error(`${link} already exists and is not managed by SkillGantry`)
      }
    }
  }

  if (!(await exists(repoDir))) {
    await mkdir(dir, { recursive: true })
    await exec('git', ['clone', repoUrl(spec.repo), repoDir])
  }
  await exec('git', ['-C', repoDir, 'checkout', spec.pin])
  const head = await exec('git', ['-C', repoDir, 'rev-parse', 'HEAD'])
  const sha = head.stdout.trim()

  const links: string[] = []
  for (const target of targets) {
    for (const name of spec.skills) {
      const link = join(target.dir, name)
      // Per skill directory, never the parent `skills/`. Upstream advises
      // `cp -r`, and the reason it gives — other skills already live in the
      // directory — is an argument against linking the parent, not a member.
      if (await occupied(link)) await unlink(link)
      await symlink(join(repoDir, 'skills', name), link)
      links.push(link)
    }
  }

  await exec('uv', ['venv', venv])
  await exec('uv', ['pip', 'install', '--python', interpreter, '-r', join(repoDir, spec.requirements)])

  return { bin: interpreter, links, sha }
}

/**
 * Three facts, because nothing in the bundle answers a version argv and
 * `verifyTool`'s semver regex rejects a commit sha. Returns the sha, which is
 * what the lock records as `resolvedVersion`.
 */
export async function verifyGitSkill(
  dir: string,
  links: readonly string[],
  sha: string,
  exec: Exec,
): Promise<string> {
  const repoDir = join(dir, 'repo')
  const head = (await exec('git', ['-C', repoDir, 'rev-parse', 'HEAD'])).stdout.trim()
  if (head !== sha) throw new Error(`${repoDir} HEAD is ${head}, locked ${sha}`)
  for (const link of links) {
    if (!(await exists(link))) throw new Error(`${link} does not resolve`)
  }
  await exec(join(dir, '.venv', 'bin', 'python'), ['--version'])
  return sha
}

/**
 * Links outlive the clone, and a dangling `~/.claude/skills/skillhone` breaks
 * every agent that scans that directory — the cost R3.1 exists to avoid, so
 * removal is an explicit path rather than a consequence of deleting the tree.
 */
export async function gitSkillUninstall(dir: string, links: readonly string[]): Promise<void> {
  for (const link of links) {
    try {
      await unlink(link)
    } catch {
      // Already gone is the outcome asked for.
    }
  }
  await rm(dir, { recursive: true, force: true })
}
