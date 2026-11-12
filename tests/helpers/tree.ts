import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Every path under `root` with a digest of its bytes and mode, sidecar
 * workspaces included — a command that claims to write nothing has to be held
 * to the sidecar too, which is where a stray run directory would appear. `.git`
 * is skipped: `git status` refreshes the index, and that is git's own bookkeeping
 * rather than a change to the tree.
 */
export async function treeSnapshot(root: string, dir = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
    const abs = join(root, rel)
    if (entry.isDirectory()) {
      out[`${rel}/`] = 'dir'
      Object.assign(out, await treeSnapshot(root, rel))
      continue
    }
    const info = await lstat(abs)
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(abs)) : await readFile(abs)
    out[rel] = `${info.mode}:${createHash('sha256').update(bytes).digest('hex')}`
  }
  return out
}
