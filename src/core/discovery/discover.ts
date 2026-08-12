import { access, readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { RepoRef, SkillRef } from '../types.js'
import { type Frontmatter, parseFrontmatter } from './frontmatter.js'

export const WORKSPACE_SUFFIX = '-workspace'
export const ROOT_WORKSPACE_DIR = '.skillgantry-workspace'

/**
 * A repo-root skill cannot use the sibling convention: a sibling of the repo
 * root lies outside the repo and could not be covered by its .gitignore.
 */
export function workspacePath(repoPath: string, relPath: string, rootSkill: boolean): string {
  return rootSkill
    ? join(repoPath, ROOT_WORKSPACE_DIR)
    : join(repoPath, `${basename(relPath)}${WORKSPACE_SUFFIX}`)
}

export function isExcludedDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith(WORKSPACE_SUFFIX)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  return exists(join(repoPath, '.git'))
}

async function toSkill(
  repo: RepoRef,
  id: string,
  dir: string,
  relPath: string,
  rootSkill: boolean,
): Promise<SkillRef> {
  // Annotated rather than inferred, so the four nulls need no `as` to widen and
  // a new `Frontmatter` field fails here instead of silently defaulting.
  // `readable: false` because a file that cannot be read is frontmatter that
  // cannot be read: the catch below lands on the flag the parser would set.
  let front: Frontmatter = {
    name: null,
    version: null,
    deprecated: false,
    supersededBy: null,
    readable: false,
  }
  try {
    front = parseFrontmatter(await readFile(join(dir, 'SKILL.md'), 'utf8'))
  } catch {
    // Unreadable SKILL.md still yields a skill with null metadata — R2.5.
  }
  return {
    id,
    name: front.name,
    version: front.version,
    dir,
    relPath,
    repo,
    rootSkill,
    workspacePath: workspacePath(repo.path, relPath, rootSkill),
    deprecated: front.deprecated,
    supersededBy: front.supersededBy,
    frontmatterReadable: front.readable,
  }
}

/**
 * How many skills a path holds, without reading or parsing any of them. The
 * wizard calls this on every pause in typing, where `discoverSkills` would have
 * read and YAML-parsed one SKILL.md per skill just to produce a number.
 */
export async function countSkills(repoPath: string): Promise<number> {
  if (await exists(join(repoPath, 'SKILL.md'))) return 1
  const entries = await readdir(repoPath, { withFileTypes: true })
  const found = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory() && !isExcludedDir(entry.name)
        ? exists(join(repoPath, entry.name, 'SKILL.md'))
        : false,
    ),
  )
  return found.filter(Boolean).length
}

/**
 * Only direct children are examined, so a nested SKILL.md inside a snapshot or
 * fixture is unreachable by construction rather than by exclusion list.
 */
export async function discoverSkills(repo: RepoRef): Promise<SkillRef[]> {
  if (await exists(join(repo.path, 'SKILL.md'))) {
    return [await toSkill(repo, repo.id, repo.path, '.', true)]
  }

  const entries = await readdir(repo.path, { withFileTypes: true })
  const skills: SkillRef[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || isExcludedDir(entry.name)) continue
    const dir = join(repo.path, entry.name)
    if (!(await exists(join(dir, 'SKILL.md')))) continue
    skills.push(await toSkill(repo, `${repo.id}/${entry.name}`, dir, entry.name, false))
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}
