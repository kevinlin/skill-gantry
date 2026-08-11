import { lstat, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Eligibility } from './types.js'

const under = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)

/**
 * `realpath` on the entry point resolves every symlink in it, so the roots have
 * to be resolved the same way or the comparison is between two spellings of one
 * path. On macOS `os.tmpdir()` alone is `/var/folders/…` against a resolved
 * `/private/var/folders/…`, which reads as a foreign install. A root that does
 * not exist yet keeps its literal spelling: there is nothing to resolve, and it
 * cannot contain the entry point either.
 */
async function resolveRoot(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * R13.10. `entryPath` is `process.argv[1]`, which is the path the shell
 * resolved — the *link*, not its target — so both halves are available without
 * scanning PATH: the link to rename over, and the target that says whose
 * install this is.
 *
 * An entry point that is not a symlink is refused even when its bytes are
 * ours. There is nothing to swing, so adopting a new version would leave this
 * invocation running the old one — which reads as an upgrade that silently did
 * nothing.
 */
export async function resolveEligibility(entryPath: string, home: string): Promise<Eligibility> {
  const versionsRoot = await resolveRoot(join(home, 'versions'))
  const legacyRoot = await resolveRoot(join(home, 'cli'))

  let target: string
  try {
    target = await realpath(entryPath)
  } catch {
    return {
      kind: 'foreign',
      runningFrom: entryPath,
      advice: 'the running entry point could not be resolved',
    }
  }

  if (!under(target, versionsRoot) && !under(target, legacyRoot)) {
    return {
      kind: 'foreign',
      runningFrom: target,
      advice: `this build does not run from ${home}. Update it where it came from — a working tree with \`pnpm install:cli\`, or \`npx skillgantry@latest\``,
    }
  }

  const link = await lstat(entryPath)
  if (!link.isSymbolicLink()) {
    return {
      kind: 'foreign',
      runningFrom: target,
      advice:
        'this build was invoked directly and not through the link on PATH, so there is nothing to repoint',
    }
  }

  return { kind: 'owned', link: entryPath, target, versionsRoot }
}
