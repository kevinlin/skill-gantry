import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The real link target, or null when nothing is installed there. */
const realBinState = async (): Promise<string | null> => {
  try {
    return await readlink(join(homedir(), '.local', 'bin', 'skillgantry'))
  } catch {
    return null
  }
}

describe('pnpm install:cli puts skillgantry on PATH', () => {
  it('installs, verifies, and survives a re-run', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-cli-home-'))
    const binDir = await mkdtemp(join(tmpdir(), 'sg-cli-bin-'))
    const link = join(binDir, 'skillgantry')

    // Capture the user's own link rather than asserting it is absent: on a
    // machine that already installed SkillGantry, absence would pass for the
    // wrong reason. What matters is that an overridden install does not move it.
    const before = await realBinState()

    const env = { ...process.env, SG_HOME: home, SG_BIN_DIR: binDir }
    await run('scripts/install-cli.sh', [], { cwd: process.cwd(), env })

    const { stdout } = await run(link, ['--version'])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)

    // The link resolves into the overridden home, not anywhere global.
    const resolved = await realpath(link)
    expect(resolved.startsWith(await realpath(home))).toBe(true)
    expect(await readdir(join(home, 'cli', 'node_modules', '.bin'))).toContain('skillgantry')

    // Re-running overwrites cleanly: one link, still runnable.
    await run('scripts/install-cli.sh', [], { cwd: process.cwd(), env })
    expect((await stat(link)).isDirectory()).toBe(false)
    const second = await run(link, ['--version'])
    expect(second.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)

    expect(await realBinState()).toBe(before)
  }, 300_000)
})
