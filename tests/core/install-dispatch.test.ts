import { describe, expect, it } from 'vitest'
import { mkdtemp, chmod, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadToolLock } from '../../src/core/config/config.js'
import type { ToolSpec } from '../../src/core/tools/catalogue.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { installTool, toolRoot } from '../../src/core/tools/install.js'

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-dispatch-'))

const NPM_TOOL: ToolSpec = {
  id: 'promptfoo',
  displayName: 'promptfoo',
  stage: 'evaluate',
  runtime: 'npm',
  install: { kind: 'npm-prefix', spec: 'promptfoo', pin: '0.100.0', binName: 'promptfoo' },
  versionArgv: ['--version'],
}

/** Stands in for npm: writes the shim the driver is about to resolve. */
const fakeNpm =
  (dir: () => string): Exec =>
  async (bin, argv) => {
    if (bin !== 'npm') throw new Error(`unexpected ${bin}`)
    const prefix = argv[argv.indexOf('--prefix') + 1] as string
    await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
    const shim = join(prefix, 'node_modules', '.bin', 'promptfoo')
    await writeFile(shim, '#!/bin/sh\necho "promptfoo 0.100.0"\n')
    await chmod(shim, 0o755)
    void dir
    return { stdout: '', stderr: '' }
  }

describe('installTool', () => {
  it('installs an npm-prefix tool under the tool root and locks it', async () => {
    const h = await home()
    const entry = await installTool(h, NPM_TOOL, { exec: fakeNpm(() => h) })

    expect(entry.installKind).toBe('npm-prefix')
    expect(entry.bin.startsWith(join(toolRoot(h), 'promptfoo'))).toBe(true)
    expect(entry.resolvedVersion).toBe('0.100.0')
    expect(entry.integrity).toBe('n/a')
    expect(entry.verifiedAt).not.toBeNull()

    const lock = await loadToolLock(h)
    expect(lock.tools.promptfoo?.bin).toBe(entry.bin)
  })

  it('writes no lock entry when verification fails', async () => {
    const h = await home()
    const brokenNpm: Exec = async (bin, argv) => {
      if (bin !== 'npm') throw new Error(`unexpected ${bin}`)
      const prefix = argv[argv.indexOf('--prefix') + 1] as string
      await mkdir(join(prefix, 'node_modules', '.bin'), { recursive: true })
      return { stdout: '', stderr: '' }
    }
    await expect(installTool(h, NPM_TOOL, { exec: brokenNpm })).rejects.toThrow(
      /could not be invoked/,
    )
    expect((await loadToolLock(h)).tools.promptfoo).toBeUndefined()
  })
})
