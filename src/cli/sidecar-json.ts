import { readFile } from 'node:fs/promises'

/** What `run.json` records that a prompt cites: the digest and git state the run was made against. */
export interface RunMetaOnDisk {
  runId: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
}

/**
 * Null only for a file that is not there. A file that is there and will not
 * read or parse throws, because the callers act on null as a fact — `fix` says
 * the run has no `run.json`, or did not execute the stage — and a corrupt file
 * reported that way sends the user looking for something that exists.
 *
 * A caller that would rather step over damage catches at its own call site,
 * where it knows what skipping means; a reader that swallowed everything could
 * not be made strict again by its callers.
 */
export const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
