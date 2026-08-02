import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface VersionsManifest {
  path: string
  versions: Record<string, string>
}

/**
 * The reference repo's shape, verified against the real file: entries nested
 * under a `skills` key, values bare semver strings. A top-level map would have
 * written a second, wrong manifest shape into twenty live skills.
 *
 * SkillGantry never creates this file (R9.1). Null means the repo has no
 * manifest, which is the case for all 54 skills in `~/.claude/skills`.
 */
export async function readVersionsManifest(repoPath: string): Promise<VersionsManifest | null> {
  const path = join(repoPath, 'versions.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const skills = (parsed as { skills?: unknown }).skills
  if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) return null
  const versions: Record<string, string> = {}
  for (const [key, value] of Object.entries(skills as Record<string, unknown>)) {
    if (typeof value === 'string') versions[key] = value
  }
  return { path, versions }
}

/** Two-space JSON with a trailing newline, which is what the real file uses. */
export function setManifestVersion(source: string, key: string, version: string): string {
  const doc = JSON.parse(source) as { skills?: Record<string, string> }
  if (!doc.skills || !(key in doc.skills)) {
    throw new Error(`versions.json has no entry for ${key}`)
  }
  doc.skills[key] = version
  return `${JSON.stringify(doc, null, 2)}\n`
}
