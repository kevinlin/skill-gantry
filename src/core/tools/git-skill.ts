import { lstat, mkdir, readFile, readlink, rm, stat, symlink, unlink } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { GitSkillSpec } from './catalogue.js'
import type { Exec } from './exec.js'
import { settingsDigest } from './skillhone-settings.js'

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
  /**
   * Absolute paths of every symlink the bundle owns after this install — made
   * now or by an earlier one — so uninstall removes exactly them and no more.
   */
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
 * The one "is this link ours" test, shared with `doctor`'s `skill-link-unmanaged`.
 * `startsWith(dir)` also accepts `<dir>-fork`, and a link recorded as ours is a
 * link uninstall removes — so it would delete a link into someone else's checkout.
 * A relative target is resolved against the link's own directory, as the kernel
 * does; against the process directory it lands wherever the process happens to be.
 */
export function linksInto(dir: string, link: string, target: string): boolean {
  const root = resolve(dir)
  const resolved = resolve(dirname(link), target)
  return resolved === root || resolved.startsWith(root.endsWith(sep) ? root : root + sep)
}

type LinkState = 'absent' | 'ours' | 'foreign'

/**
 * lstat, not stat: a dangling symlink still occupies the name, so `symlink()`
 * over it throws `EEXIST` — and one pointing into `dir` is ours whether or not
 * the clone behind it is still there.
 */
async function linkState(dir: string, link: string): Promise<LinkState> {
  let info
  try {
    info = await lstat(link)
  } catch {
    return 'absent'
  }
  if (!info.isSymbolicLink()) return 'foreign'
  try {
    return linksInto(dir, link, await readlink(link)) ? 'ours' : 'foreign'
  } catch {
    return 'foreign'
  }
}

/**
 * Per directory, not global: a machine holding the bundle in `~/.claude/skills`
 * and nothing in `~/.agents/skills` needs links in the second without the first
 * being touched. Answering this globally is what would leave one runtime short.
 *
 * `holds` is "an agent can load the whole bundle from here", so every skill
 * counts. Probing the first alone read a directory missing the rest as complete.
 */
export async function detectSkillDirs(
  home: string,
  spec: GitSkillSpec,
): Promise<{ dir: string; holds: boolean }[]> {
  const found: { dir: string; holds: boolean }[] = []
  for (const runtime of RUNTIME_SKILL_DIRS) {
    const dir = join(home, runtime, 'skills')
    if (!(await exists(dir))) continue
    const present = await Promise.all(
      spec.skills.map((name) => exists(join(dir, name, 'SKILL.md'))),
    )
    found.push({ dir, holds: spec.skills.length > 0 && present.every(Boolean) })
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

  const dirs = await detectSkillDirs(userHome, spec)

  if (!(await exists(repoDir))) {
    await mkdir(dir, { recursive: true })
    await exec('git', ['clone', repoUrl(spec.repo), repoDir])
  }
  await exec('git', ['-C', repoDir, 'checkout', spec.pin])
  const head = await exec('git', ['-C', repoDir, 'rev-parse', 'HEAD'])
  const sha = head.stdout.trim()

  // Decided per (directory, skill) at the moment of writing, and a foreign
  // entry is skipped rather than refused: there is nothing to refuse early, so
  // no check precedes the clone. Deciding per directory read a reinstall as
  // "already installed" through our own link and recorded none of them.
  const links: string[] = []
  for (const target of dirs) {
    for (const name of spec.skills) {
      const link = join(target.dir, name)
      const state = await linkState(dir, link)
      if (state === 'foreign') continue
      // Per skill directory, never the parent `skills/`. Upstream advises
      // `cp -r`, and the reason it gives — other skills already live in the
      // directory — is an argument against linking the parent, not a member.
      if (state === 'ours') await unlink(link)
      await symlink(join(repoDir, 'skills', name), link)
      links.push(link)
    }
  }

  // A bundle with no requirements takes neither the venv nor an interpreter:
  // building an empty one would install a runtime the tool never uses and leave
  // `verifyGitSkill` probing a python no code path reaches — design §5.2.
  if (spec.requirements === undefined) {
    // The linked skill directory inside the clone, which is a path a
    // verification can check and R6.13's prompt can name. Recording nothing is
    // worse in both directions: `checkLockedTool` reads `bin` before it
    // branches, and the prompt has to say where the authoring skill is.
    return { bin: join(repoDir, 'skills', spec.skills[0] ?? ''), links, sha }
  }

  await exec('uv', ['venv', venv])
  await exec('uv', ['pip', 'install', '--python', interpreter, '-r', join(repoDir, spec.requirements)])

  return { bin: interpreter, links, sha }
}

/**
 * Three facts, because nothing in the bundle answers a version argv and
 * `verifyTool`'s semver regex rejects a commit sha. Returns the sha, which is
 * what the lock records as `resolvedVersion`.
 *
 * Two facts for a bundle that declared no requirements: there is no
 * interpreter to run, and probing one that was never built would report every
 * such install as `unverifiable` — design §5.2.
 */
export async function verifyGitSkill(
  dir: string,
  links: readonly string[],
  sha: string,
  exec: Exec,
  hasInterpreter = true,
): Promise<string> {
  const repoDir = join(dir, 'repo')
  const head = (await exec('git', ['-C', repoDir, 'rev-parse', 'HEAD'])).stdout.trim()
  if (head !== sha) throw new Error(`${repoDir} HEAD is ${head}, locked ${sha}`)
  for (const link of links) {
    if (!(await exists(link))) throw new Error(`${link} does not resolve`)
  }
  if (hasInterpreter) await exec(join(dir, '.venv', 'bin', 'python'), ['--version'])
  return sha
}

/**
 * Links outlive the clone, and a dangling `~/.claude/skills/skillhone` breaks
 * every agent that scans that directory — the cost R3.1 exists to avoid, so
 * removal is an explicit path rather than a consequence of deleting the tree.
 *
 * `config` is R3.10's file, removed on the same rule and with one extra
 * condition: it is deleted only while its bytes still hash to what the lock
 * recorded. The file holds the user's credential and may have been edited
 * against a gateway this build knows nothing about, so an edited one is left
 * behind — the same preimage recheck §12.5 gives the suppress writer, for a
 * sharper reason, since here the recheck guards a delete rather than a write.
 */
export async function gitSkillUninstall(
  dir: string,
  links: readonly string[],
  config?: { path: string; sha256: string },
): Promise<void> {
  for (const link of links) {
    try {
      await unlink(link)
    } catch {
      // Already gone is the outcome asked for.
    }
  }
  if (config) {
    try {
      const text = await readFile(config.path, 'utf8')
      if (settingsDigest(text) === config.sha256) await unlink(config.path)
    } catch {
      // Already gone is the outcome asked for.
    }
  }
  await rm(dir, { recursive: true, force: true })
}
