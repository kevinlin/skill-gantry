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
    // execFile's rejection carries stdout as string | Buffer depending on
    // encoding, which is not part of Exec's Promise<ExecResult> contract —
    // hence the cast rather than a type already in scope.
    const partial = (err as { stdout?: string | Buffer }).stdout
    if (partial === undefined) throw err
    stdout = partial.toString()
  }
  return rewriteHeaders(stdout, from, to, label)
}

/**
 * Substituted rather than passed as --src-prefix, because git rejects a
 * prefix containing a path separator on some versions and silently keeps the
 * temp path on others. A global substring replace of the raw paths is unsafe
 * here: git strips the leading `/` from an absolute path and prepends its own
 * `a/`/`b/`, so `from` (which still has the leading `/`) matches the tail of
 * `a/tmp/x/a` and glues onto git's prefix, producing `ask/SKILL.md` instead of
 * `a/sk/SKILL.md`. Only the three header lines carry a path, so each is
 * rewritten on its own terms instead.
 */
function rewriteHeaders(stdout: string, from: string, to: string, label: string): string {
  if (stdout === '') return stdout
  const nullFrom = from === NULL_PATH
  const nullTo = to === NULL_PATH
  return stdout
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) return `diff --git a/${label} b/${label}`
      if (line.startsWith('--- ')) return nullFrom ? line : `--- a/${label}`
      if (line.startsWith('+++ ')) return nullTo ? line : `+++ b/${label}`
      return line
    })
    .join('\n')
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
