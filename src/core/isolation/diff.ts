import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Exec, defaultExec } from '../tools/exec.js'

/** An absent side renders against /dev/null, which git accepts as a path. */
const NULL_PATH = '/dev/null'

/**
 * One renderer for both strategies, which is what makes R10.5's identical
 * review a property of the code rather than two implementations agreeing.
 * `--no-index` works outside a repository, so a non-git repo needs no repo to
 * produce the same text the worktree strategy does.
 *
 * `git diff` exits 1 when the files differ. That is the successful case, so the
 * rejection is inspected for output rather than rethrown.
 */
export async function unifiedDiffFor(
  a: string | null,
  b: string | null,
  label: string,
  exec: Exec = defaultExec,
): Promise<string> {
  const from = a ?? NULL_PATH
  const to = b ?? NULL_PATH
  let stdout: string
  try {
    stdout = (await exec('git', ['diff', '--no-index', '--binary', '--', from, to], {
      timeoutMs: 60_000,
    })).stdout
  } catch (err) {
    const partial = (err as { stdout?: string | Buffer }).stdout
    if (partial === undefined) throw err
    stdout = partial.toString()
  }
  // Substituted rather than passed as --src-prefix, because git rejects a
  // prefix containing a path separator on some versions and silently keeps the
  // temp path on others.
  return stdout.replaceAll(from, label).replaceAll(to, label)
}

/** A pair of temp files, for diffing bytes that are not both on disk. */
export async function diffBuffers(
  before: Buffer | null,
  after: Buffer | null,
  label: string,
  exec: Exec = defaultExec,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-diff-'))
  let a: string | null = null
  let b: string | null = null
  if (before) {
    a = join(dir, 'before')
    await writeFile(a, before)
  }
  if (after) {
    b = join(dir, 'after')
    await writeFile(b, after)
  }
  return unifiedDiffFor(a, b, label, exec)
}
