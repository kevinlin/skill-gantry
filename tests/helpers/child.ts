import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const TMP_DIR = join(process.cwd(), 'tests', 'tmp')

/** Import prefix for a child module, which lives two levels below the repo root. */
export const CORE = '../../src/core'

/**
 * Runs a module in a second Node process against this repo's sources. The
 * second process is the point: R6.7 and R6.9 are about two processes sharing a
 * directory, and an in-process test shares a lock table instead.
 */
export async function runInChild(source: string): Promise<string> {
  await mkdir(TMP_DIR, { recursive: true })
  const file = join(TMP_DIR, `child-${randomUUID()}.ts`)
  await writeFile(file, source)
  try {
    const { stdout } = await exec('pnpm', ['exec', 'tsx', file], { cwd: process.cwd() })
    return stdout
  } finally {
    await rm(file, { force: true })
  }
}
