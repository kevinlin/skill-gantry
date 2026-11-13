import { canonicalisePath, discoverSkills, registerRepo } from '../core/index.js'
import type { CliDeps } from './run-command.js'

export interface RepoAddOptions {
  json?: boolean
}

/**
 * R12.15. `registerRepo` is the function the wizard's repo step calls, so the
 * rules — a duplicate refuses, a path that is not a directory refuses, both
 * before anything is written — are the wizard's and not a headless copy of them.
 * The refusals throw and reach `main()`'s handler as `2`.
 */
export async function runRepoAdd(deps: CliDeps, path: string, opts: RepoAddOptions): Promise<void> {
  const config = await registerRepo(deps.home, path)
  const resolved = await canonicalisePath(path)
  const repo = config.repos.find((entry) => entry.path === resolved)
  if (repo === undefined) throw new Error(`registered ${resolved} but it is not in the config`)

  // Discovery, not `countSkills`: `list` is what a caller reads next, and the
  // count it was promised has to be the number of rows it will meet.
  const skills = (await discoverSkills(repo)).length

  if (opts.json === true) {
    deps.write(
      JSON.stringify({
        repo: { id: repo.id, path: repo.path, name: repo.name, isGit: repo.isGit },
        skills,
      }),
    )
    return
  }
  deps.write(`registered ${repo.id} (${repo.path}): ${skills} skill${skills === 1 ? '' : 's'}`)
}
