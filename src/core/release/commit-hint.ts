import { type Exec, defaultExec } from '../tools/exec.js'

/**
 * Characters no POSIX shell, zsh included, treats specially in an argument.
 * `=` and `~` are left out on purpose: zsh expands a word that begins with
 * either, and a path that merely contains one is better quoted than argued over.
 */
const PLAIN_WORD = /^[A-Za-z0-9_@%+:,./-]+$/

/**
 * Single quotes, the one form with nothing left to escape but the quote itself.
 * Double quotes would still expand `$`, a backtick and — in an interactive shell
 * — `!`, and a skill directory is named by whoever wrote the repo.
 */
const shellQuote = (word: string): string =>
  PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`

export interface CommitHintInput {
  /** The repo root, which `git -C` is pointed at; `paths` are relative to it. */
  repo: string
  name: string
  /** The resolved semver, not the bump level the user typed. */
  version: string
  paths: readonly string[]
}

/**
 * R9.7: the two commands that commit what a release changed and nothing else,
 * named and never run. The paths are on the commit as well as on the add. A
 * release is permitted over a tree with other work staged — R10.3's dirty check
 * covers the release scope and nothing else — and a bare `git commit` would
 * sweep that work into a commit titled for one skill; with a pathspec git
 * commits those paths alone and leaves the rest of the index as it was.
 *
 * Empty for no paths, for the same reason turned inside out: the commit line
 * with its pathspec dropped is exactly the bare commit.
 */
export function commitHint(input: CommitHintInput): string[] {
  if (input.paths.length === 0) return []
  const repo = shellQuote(input.repo)
  const paths = input.paths.map(shellQuote).join(' ')
  const message = shellQuote(`release(${input.name}): ${input.version}`)
  return [`git -C ${repo} add -- ${paths}`, `git -C ${repo} commit -m ${message} -- ${paths}`]
}

/**
 * The subset of `paths`, in the order given, that git reports as changed in the
 * working tree at `repoPath` — which is what a `git add` will accept.
 *
 * Without `--ignored`, so a file the repo's `.gitignore` covers is not
 * reported: a release archive under `*.zip` was handed to an add that refuses
 * it ("paths are ignored by one of your .gitignore files") and takes the whole
 * command down with it, the tracked files included. `--untracked-files=all`
 * because the default collapses a directory git has never seen into one `dir/`
 * entry, and the file inside it would then match nothing.
 *
 * Takes the `Exec` so a caller's tests keep git out of the host, and lives
 * beside `commitHint` so the terminal interface, which cannot spawn, can reach
 * it through a caller that can.
 */
export async function gitChangedPaths(
  repoPath: string,
  paths: readonly string[],
  exec: Exec = defaultExec,
): Promise<string[]> {
  if (paths.length === 0) return []
  const { stdout } = await exec(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths],
    { cwd: repoPath, timeoutMs: 60_000 },
  )

  const reported = new Set<string>()
  const fields = stdout.split('\0').filter((field) => field.length > 0)
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] as string
    reported.add(field.slice(3))
    // `status -z` puts the new path first for a rename or copy and the old one
    // in the next field; both are changed.
    if (/^[RC]|^.[RC]/.test(field)) {
      i += 1
      const old = fields[i]
      if (old !== undefined) reported.add(old)
    }
  }
  return paths.filter((path) => reported.has(path))
}
