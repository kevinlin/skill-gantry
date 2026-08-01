import { describe, expect, it } from 'vitest'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installAndLock, toolRoot, verifyTool } from '../../src/core/tools/install.js'
import { loadToolLock } from '../../src/core/config/config.js'

const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-tools-'))

/**
 * SkillSpector is published as a git source only; it is absent from PyPI, and
 * upstream carries no 2.3.7 tag, so the pin is the newest tag it does carry.
 */
const SPEC = {
  id: 'skillspector',
  kind: 'uv-tool' as const,
  spec: 'git+https://github.com/NVIDIA/skillspector.git',
  pin: 'v2.5.1',
  binName: 'skillspector',
}

describe('installAndLock', () => {
  it('installs into the tool root and never the global uv dir', async () => {
    const h = await home()
    const entry = await installAndLock(h, SPEC, ['--version'])
    expect(entry.bin).toBe(join(toolRoot(h), 'skillspector', 'bin', 'skillspector'))
    await expect(stat(entry.bin)).resolves.toBeTruthy()
    expect(entry.bin.startsWith(toolRoot(h))).toBe(true)
  }, 300_000)

  it('records the resolved version, integrity and both timestamps', async () => {
    const h = await home()
    const entry = await installAndLock(h, SPEC, ['--version'])
    expect(entry.resolvedVersion).toBe('2.5.1')
    expect(entry.requestedPin).toBe('v2.5.1')
    expect(entry.integrity).toBe('n/a')
    expect(entry.verifiedAt).not.toBeNull()
  }, 300_000)

  it('writes the entry into lock.json under the tool id', async () => {
    const h = await home()
    await installAndLock(h, SPEC, ['--version'])
    const lock = await loadToolLock(h)
    expect(lock.tools.skillspector?.installKind).toBe('uv-tool')
  }, 300_000)

  it('fails the install when the executable cannot be invoked', async () => {
    const h = await home()
    await expect(
      verifyTool({ ...(await installAndLock(h, SPEC, ['--version'])), bin: '/nonexistent/x' }, [
        '--version',
      ]),
    ).rejects.toThrow(/could not be invoked/)
  }, 300_000)

  it('refuses a pin the index does not have', async () => {
    const h = await home()
    await expect(
      installAndLock(h, { ...SPEC, pin: 'v0.0.0-does-not-exist' }, ['--version']),
    ).rejects.toThrow(/install failed/)
  }, 300_000)
})
