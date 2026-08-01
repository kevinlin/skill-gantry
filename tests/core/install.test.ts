import { describe, expect, it } from 'vitest'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installAndLock, installTool, toolRoot, verifyTool } from '../../src/core/tools/install.js'
import { loadToolLock } from '../../src/core/config/config.js'
import { CATALOGUE, catalogueEntry } from '../../src/core/tools/catalogue.js'

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

describe('installTool against real indexes', () => {
  it('installs every catalogued tool into the tool root and verifies it', async () => {
    for (const spec of CATALOGUE) {
      const h = await home()
      const entry = await installTool(h, spec)
      expect(entry.bin.startsWith(toolRoot(h))).toBe(true)
      expect(entry.resolvedVersion.length).toBeGreaterThan(0)
      if (spec.install.kind === 'gh-release' && spec.install.integrity.kind !== 'none') {
        expect(entry.integrity.startsWith('sha256:')).toBe(true)
      }
    }
  }, 900_000)

  it('leaves the user-global uv tool directory untouched', async () => {
    // The reference machine already carries a hand-installed skillspector, so
    // "the path does not exist" would pass for the wrong reason on a clean
    // machine and fail for the wrong reason here. What R3.1 actually forbids is
    // our install writing there, so the check is that it did not change.
    const global = join(process.env.HOME ?? '', '.local/share/uv/tools/skillspector')
    const before = await stat(global).catch(() => null)

    const h = await home()
    await installTool(h, catalogueEntry('skillspector')!)

    const after = await stat(global).catch(() => null)
    if (before === null) expect(after).toBeNull()
    else expect(after?.mtimeMs).toBe(before.mtimeMs)
  }, 300_000)
})
