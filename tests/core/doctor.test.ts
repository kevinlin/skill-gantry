import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveToolLock } from '../../src/core/config/config.js'
import type { ToolLockEntry } from '../../src/core/config/schema.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { CATALOGUE } from '../../src/core/tools/catalogue.js'
import { doctor } from '../../src/core/tools/doctor.js'
import { toolRoot } from '../../src/core/tools/install.js'
import { runtimesFor } from '../../src/core/tools/runtimes.js'
import { makeRepo, SKILL_MD } from '../helpers/tmp-repo.js'

const entry = (over: Partial<ToolLockEntry> = {}): ToolLockEntry => ({
  installKind: 'uv-tool',
  requestedPin: 'v1.0.0',
  resolvedVersion: '1.0.0',
  bin: '/nonexistent/bin',
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
  ...over,
})

async function fakeBin(dir: string, name: string, body: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-doctor-'))

describe('doctor', () => {
  it('reports a lock entry whose binary is gone as missing', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: { alpha: entry() } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'alpha')?.kind).toBe('missing')
    expect(report.failed).toBe(true)
  })

  it('reports a binary that will not run as unverifiable', async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'beta', 'bin'), 'beta', 'exit 1')
    await saveToolLock(h, { version: 1, tools: { beta: entry({ bin }) } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'beta')?.kind).toBe('unverifiable')
  })

  it('reports a different reported version as version-drift', async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'gamma', 'bin'), 'gamma', 'echo "gamma 2.0.0"')
    await saveToolLock(h, { version: 1, tools: { gamma: entry({ bin }) } })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    const found = report.tools.find((t) => t.toolId === 'gamma')
    expect(found).toMatchObject({
      kind: 'version-drift',
      expectedVersion: '1.0.0',
      actualVersion: '2.0.0',
    })
  })

  it('reports a directory under the tool root with no lock entry as unlocked', async () => {
    const h = await home()
    await mkdir(join(toolRoot(h), 'delta'), { recursive: true })
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'delta')?.kind).toBe('unlocked')
  })

  it("surfaces integrity 'none' as a warning that does not fail the report — R3.2b", async () => {
    const h = await home()
    const bin = await fakeBin(join(toolRoot(h), 'epsilon', 'bin'), 'epsilon', 'echo "1.0.0"')
    await saveToolLock(h, {
      version: 1,
      tools: { epsilon: entry({ bin, installKind: 'gh-release', integrity: 'none' }) },
    })
    const report = await doctor({ home: h, skills: [], ledgerLifecycle: new Map() })
    expect(report.tools.find((t) => t.toolId === 'epsilon')?.kind).toBe('integrity-unverified')
    expect(report.failed).toBe(false)
  })

  it('reports lifecycle drift between frontmatter and the ledger cache', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const root = await makeRepo({
      files: {
        'declawed/SKILL.md': `---\nname: declawed\nmetadata:\n  version: 1.0.0\n  deprecated: true\n---\n`,
        'gap/SKILL.md': SKILL_MD('gap'),
      },
    })
    const skills = await discoverSkills({ id: 'r', path: root, name: 'r', isGit: false })
    const report = await doctor({
      home: h,
      skills,
      ledgerLifecycle: new Map([
        ['r/declawed', 'active'],
        ['r/gap', 'active'],
      ]),
    })
    expect(report.lifecycle).toEqual([{ skillId: 'r/declawed', file: 'deprecated', ledger: 'active' }])
    // A cache the file disagrees with is drift to report, not an error — R1.6.
    expect(report.failed).toBe(false)
  })

  it('probes exactly the runtimes the catalogue needs', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const report = await doctor({
      home: h,
      skills: [],
      ledgerLifecycle: new Map(),
      exec: async (bin) => ({ stdout: `${bin} 1.0.0`, stderr: '' }),
    })
    const expected = runtimesFor(CATALOGUE).filter((runtime) => runtime !== 'none')
    expect(report.runtimes.map((r) => r.runtime).sort()).toEqual([...expected].sort())
    expect(report.runtimes.every((r) => r.present)).toBe(true)
  })
})
