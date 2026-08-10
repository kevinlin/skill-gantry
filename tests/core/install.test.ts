import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installAndLock, installTool, toolRoot, verifyTool } from '../../src/core/tools/install.js'
import { loadToolLock } from '../../src/core/config/config.js'
import {
  CATALOGUE,
  SKILLHONE_TOOL_ID,
  SKILL_UPPER_TOOL_ID,
  catalogueEntry,
} from '../../src/core/tools/catalogue.js'
import { defaultExec } from '../../src/core/tools/exec.js'
import { verifyGitSkill } from '../../src/core/tools/git-skill.js'
import { getAdapter } from '../../src/core/adapters/registry.js'

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

// Offline: it reads the catalogue and the registry, nothing else.
describe('catalogue and adapter registry agree', () => {
  it('gives every stage-selectable catalogued tool an adapter — R3.5b', () => {
    for (const spec of CATALOGUE) {
      const adapter = getAdapter(spec.id)
      if (spec.stage === null) {
        // The release installer is invoked by a stage, selected by none, so an
        // adapter would make it reachable by AdapterStageExecutor.plan().
        expect(adapter, `${spec.id} must not have an adapter`).toBeUndefined()
      } else {
        expect(adapter, `${spec.id} has no adapter`).toBeDefined()
      }
    }
  })
})

describe('installTool against real indexes', () => {
  it('installs every catalogued tool into the tool root and verifies it', async () => {
    for (const spec of CATALOGUE) {
      const h = await home()
      // A `git-skill` install is the one kind that writes outside the tool root
      // (R3.1's carve-out), so its link targets are redirected at a temp home —
      // a test must not put symlinks in the machine's real runtime directories.
      const entry = await installTool(h, spec, { userHome: await home() })
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

  it('really clones SkillHone at the catalogued pin, links it, and verifies three facts', async () => {
    const spec = catalogueEntry(SKILLHONE_TOOL_ID)!
    if (spec.install.kind !== 'git-skill') throw new Error('skillhone is not a git-skill entry')

    // Captured first, for the reason the uv case above records: asserting a
    // path "does not exist" passes on a clean machine for a reason unrelated
    // to R3.1's rule. What the rule forbids is our install writing there.
    const site = join(process.env.HOME ?? '', '.local/lib')
    const before = await stat(site).catch(() => null)

    const h = await home()
    const userHome = await home()
    await mkdir(join(userHome, '.agents', 'skills'), { recursive: true })
    const entry = await installTool(h, spec, { userHome })

    expect(entry.installKind).toBe('git-skill')
    expect(entry.resolvedVersion).toBe(spec.install.pin)
    expect(entry.bin).toBe(join(toolRoot(h), SKILLHONE_TOOL_ID, '.venv', 'bin', 'python'))
    expect(entry.links).toHaveLength(spec.install.skills.length)
    await expect(
      verifyGitSkill(
        join(toolRoot(h), SKILLHONE_TOOL_ID),
        entry.links ?? [],
        entry.resolvedVersion,
        defaultExec,
      ),
    ).resolves.toBe(spec.install.pin)

    const after = await stat(site).catch(() => null)
    if (before === null) expect(after).toBeNull()
    else expect(after?.mtimeMs).toBe(before.mtimeMs)
  }, 900_000)

  it('really clones skill-upper at the release tag, links it, and builds no venv', async () => {
    const spec = catalogueEntry(SKILL_UPPER_TOOL_ID)!
    if (spec.install.kind !== 'git-skill') throw new Error('skill-upper is not a git-skill entry')

    const h = await home()
    const userHome = await home()
    await mkdir(join(userHome, '.agents', 'skills'), { recursive: true })
    const entry = await installTool(h, spec, { userHome })

    const dir = join(toolRoot(h), SKILL_UPPER_TOOL_ID)
    // R3.11: the linked skill directory, not an interpreter — a path a
    // verification can check and R6.13's prompt can name.
    expect(entry.bin).toBe(join(dir, 'repo', 'skills', SKILL_UPPER_TOOL_ID))
    // R3.3 keeps the two apart, and a tag pin is where that matters: the
    // request is `v0.7.0` and the resolution is the sha it names. SkillHone's
    // case above cannot show it, its pin already being a sha.
    expect(entry.requestedPin).toBe(spec.install.pin)
    expect(entry.resolvedVersion).toMatch(/^[0-9a-f]{40}$/)
    expect(entry.links).toEqual([join(userHome, '.agents', 'skills', SKILL_UPPER_TOOL_ID)])
    // The probe this milestone was written against: the tag really carries the
    // skill. A fixture cannot answer that, which is why this case is here.
    await expect(stat(join(entry.bin, 'SKILL.md'))).resolves.toBeTruthy()
    // No venv is built at all, so verification is two facts rather than three.
    await expect(stat(join(dir, '.venv'))).rejects.toThrow()
    await expect(
      verifyGitSkill(dir, entry.links ?? [], entry.resolvedVersion, defaultExec, false),
    ).resolves.toBe(entry.resolvedVersion)
  }, 900_000)
})
