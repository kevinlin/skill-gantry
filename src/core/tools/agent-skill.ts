import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename as fsRename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { VERSION } from '../version.js'

/**
 * §5.5, R3.13. Not a catalogue entry and not a lock entry, so nothing in
 * `install.ts`, `git-skill.ts` or the lock is reachable from here: a link into
 * an upgradable prefix goes stale, and `gitSkillUninstall` removes a package
 * root.
 */

export const AGENT_SKILL_NAME = 'skillgantry'
export const BUNDLED_MARKER = '.skillgantry-bundled.json'

const Marker = z.strictObject({ managedBy: z.literal('skillgantry'), version: z.string().min(1) })

/**
 * Located the way `version.ts` finds `package.json`: three levels up from
 * `dist/core/tools/` and from `src/core/tools/` alike, so an installed prefix
 * and a working tree both resolve.
 */
export const bundledSkillDir = (): string =>
  fileURLToPath(new URL(`../../../skills/${AGENT_SKILL_NAME}`, import.meta.url))

/**
 * A package that lost its `skills` directory must fail here. Installing the
 * empty tree would put a valid marker on a copy with nothing in it, and every
 * later install would trust it.
 */
export async function locateBundledSkill(): Promise<string> {
  const dir = bundledSkillDir()
  const entry = await stat(join(dir, 'SKILL.md')).catch(() => null)
  if (!entry?.isFile()) throw new Error(`the bundled skill is missing: no SKILL.md in ${dir}`)
  return dir
}

/** Where the default install writes, and the only place doctor looks (§5.5). */
export const defaultSkillsDir = (userHome: string): string => join(userHome, '.claude', 'skills')

export const defaultAgentSkillPath = (userHome: string): string =>
  join(defaultSkillsDir(userHome), AGENT_SKILL_NAME)

export type Occupant =
  | { kind: 'absent' }
  | { kind: 'ours'; version: string }
  /** `why` completes the sentence "it is ...". */
  | { kind: 'refused'; why: string }

/**
 * `lstat` and a regular-file marker, so a link is never followed: neither the
 * destination nor the marker inside it. Ownership is the marker's *contents* —
 * presence alone proves only that something wrote a file of that name.
 */
export async function inspectAgentSkill(path: string): Promise<Occupant> {
  const entry = await lstat(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (entry === null) return { kind: 'absent' }
  if (entry.isSymbolicLink()) return { kind: 'refused', why: 'a symbolic link' }
  if (!entry.isDirectory()) return { kind: 'refused', why: 'not a directory' }

  const markerPath = join(path, BUNDLED_MARKER)
  const markerEntry = await lstat(markerPath).catch(() => null)
  const unmarked: Occupant = {
    kind: 'refused',
    why: `a directory with no valid ${BUNDLED_MARKER} naming skillgantry`,
  }
  if (!markerEntry?.isFile()) return unmarked
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(markerPath, 'utf8'))
  } catch {
    return unmarked
  }
  const marker = Marker.safeParse(raw)
  return marker.success ? { kind: 'ours', version: marker.data.version } : unmarked
}

export interface InstallAgentSkillOptions {
  /** The directory `skillgantry` goes inside. It must already exist. */
  skillsDir: string
  /** Test seam: defaults to the package's own `skills/skillgantry`. */
  source?: string
  /** Test seam: defaults to the running `VERSION`. */
  version?: string
  /** Test seam for the failure the swap has to survive. */
  rename?: (from: string, to: string) => Promise<void>
}

export interface InstalledAgentSkill {
  path: string
  version: string
  replaced: boolean
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Replacement is two renames, because `rename` will not replace a non-empty
 * directory, with the old copy kept until the second lands. Every byte is
 * reproducible from the package, so the old copy is kept for the swap and no
 * longer. An interruption between the renames leaves no destination and a
 * marked sibling, which the next call removes.
 */
export async function installAgentSkill(
  options: InstallAgentSkillOptions,
): Promise<InstalledAgentSkill> {
  const { skillsDir } = options
  const source = options.source ?? (await locateBundledSkill())
  const version = options.version ?? VERSION
  const move = options.rename ?? fsRename

  if (!(await stat(skillsDir).catch(() => null))?.isDirectory()) {
    throw new Error(`no such directory: ${skillsDir}`)
  }

  const path = join(skillsDir, AGENT_SKILL_NAME)
  const fresh = `${path}.sg-new`
  const old = `${path}.sg-old`

  // Every refusal is decided before the first removal. Interleaving them would
  // make "a refusal writes nothing" depend on the order the siblings happened
  // to be visited in.
  const occupant = await inspectAgentSkill(path)
  if (occupant.kind === 'refused') {
    throw new Error(
      `refusing to replace ${path}: it is ${occupant.why}; skillgantry replaces only a copy it wrote`,
    )
  }
  const leftovers: string[] = []
  for (const sibling of [fresh, old]) {
    const found = await inspectAgentSkill(sibling)
    if (found.kind === 'refused') {
      throw new Error(
        `refusing to remove ${sibling}: it is ${found.why}; ` +
          'it can no more be shown to be skillgantry\'s than a destination can — remove it and re-run',
      )
    }
    if (found.kind === 'ours') leftovers.push(sibling)
  }
  for (const sibling of leftovers) await rm(sibling, { recursive: true, force: true })

  const discard = (): Promise<void> => rm(fresh, { recursive: true, force: true })
  try {
    // The marker goes in first. A build interrupted after this line leaves a
    // sibling the next call can prove it wrote; marker-last would leave one it
    // must refuse, and the user would be deleting a half-copied directory by hand.
    await mkdir(fresh)
    await writeFile(
      join(fresh, BUNDLED_MARKER),
      `${JSON.stringify({ managedBy: 'skillgantry', version })}\n`,
    )
    // Entry by entry: `cp` refuses a directory destination that already exists,
    // and the marker has made this one exist. `errorOnExist` also means a
    // source that shipped its own marker fails loudly rather than overwriting
    // the one just written.
    for (const entry of await readdir(source)) {
      await cp(join(source, entry), join(fresh, entry), {
        recursive: true,
        force: false,
        errorOnExist: true,
      })
    }
  } catch (err) {
    await discard().catch(() => undefined)
    throw err
  }

  const replaced = occupant.kind === 'ours'
  if (replaced) {
    try {
      await move(path, old)
    } catch (err) {
      await discard().catch(() => undefined)
      throw new Error(`could not replace ${path}: ${message(err)}`, { cause: err })
    }
  }
  try {
    await move(fresh, path)
  } catch (err) {
    if (replaced) {
      try {
        await move(old, path)
      } catch (restore) {
        throw new Error(
          `could not replace ${path} (${message(err)}) and could not move the previous copy ` +
            `back from ${old} (${message(restore)}); it is intact there`,
          { cause: err },
        )
      }
    }
    await discard().catch(() => undefined)
    throw new Error(`could not replace ${path}: ${message(err)}`, { cause: err })
  }
  // The install has landed. A copy that will not delete is a marked sibling the
  // next call removes, which is not a reason to report a failure now.
  if (replaced) await rm(old, { recursive: true, force: true }).catch(() => undefined)

  return { path, version, replaced }
}
