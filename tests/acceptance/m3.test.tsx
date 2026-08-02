import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadToolLock,
  saveConfig,
  saveToolLock,
} from '../../src/core/config/config.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { RULE_CLASS_MAP_VERSION } from '../../src/core/adapters/rule-classes.js'
import { RELEASE_TOOL_ID } from '../../src/core/tools/catalogue.js'
import { toolRoot } from '../../src/core/tools/install.js'
import type { SetupDriver } from '../../src/core/index.js'
import { doctor } from '../../src/core/tools/doctor.js'
import { SetupApp } from '../../src/tui/setup-app.js'
import { renderInk } from '../helpers/render-ink.js'
import { makeRepo, SKILL_MD } from '../helpers/tmp-repo.js'
import { buildSetupDriver } from '../../src/cli/setup-command.js'

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-m3-'))

async function fakeInstalled(h: string, toolId: string, version: string): Promise<string> {
  const dir = join(toolRoot(h), toolId, 'bin')
  await mkdir(dir, { recursive: true })
  const bin = join(dir, toolId)
  await writeFile(bin, `#!/bin/sh\necho "${toolId} ${version}"\n`)
  await chmod(bin, 0o755)
  return bin
}

describe('M3 exit criterion: a clean machine reaches a verified toolchain through the wizard alone', () => {
  it('probes, selects a preset, installs, verifies, writes the selection and registers a repo', async () => {
    const h = await home()
    const repo = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed') } })

    // Only the network is stubbed: config, the lock, verification and the state
    // machine are the real ones.
    const real = buildSetupDriver(h)
    const driver: SetupDriver = {
      ...real,
      probe: async () => [
        { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'x' },
        { runtime: 'npm', present: true, version: '11.0.0', installCommand: 'y' },
      ],
      install: async (toolId) => {
        const bin = await fakeInstalled(h, toolId, '1.0.0')
        const lock = await loadToolLock(h)
        await saveToolLock(h, {
          ...lock,
          tools: {
            ...lock.tools,
            [toolId]: {
              installKind: 'uv-tool',
              requestedPin: 'v1.0.0',
              resolvedVersion: '1.0.0',
              bin,
              integrity: 'n/a',
              installedAt: new Date().toISOString(),
              verifiedAt: new Date().toISOString(),
            },
          },
        })
      },
    }

    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(200)
    ink.stdin.send('\r')
    await ink.settle(40)
    for (const ch of repo) ink.stdin.send(ch)
    await ink.settle(60)
    ink.stdin.send('\r')
    await ink.settle(80)

    const lock = await loadToolLock(h)
    expect(Object.keys(lock.tools)).toContain('skillspector')
    for (const entry of Object.values(lock.tools)) {
      expect(entry.verifiedAt).not.toBeNull()
      expect(entry.bin.startsWith(toolRoot(h))).toBe(true)
    }

    const config = await loadConfig(h)
    expect(config.repos).toHaveLength(1)
    // Membership, not equality: a preset that installs two security tools puts
    // both here, and M4 registers more adapters than M3 did.
    expect(config.stageTools.security).toContain('skillspector')
    expect(Object.values(config.stageTools).flat()).not.toContain(RELEASE_TOOL_ID)

    const report = await doctor({
      home: h,
      skills: await discoverSkills(config.repos[0]!),
      ledgerLifecycle: new Map(),
      ruleMap: { applied: RULE_CLASS_MAP_VERSION, current: RULE_CLASS_MAP_VERSION },
    })
    expect(report.failed).toBe(false)
    ink.unmount()
  })
})

describe('M3 exit criterion: doctor reports all four drift kinds plus integrity and lifecycle drift', () => {
  it('reports six conditions from one home', async () => {
    const h = await home()
    const good = await fakeInstalled(h, 'gamma', '2.0.0')
    const broken = await fakeInstalled(h, 'beta', '1.0.0')
    await writeFile(broken, '#!/bin/sh\nexit 1\n')
    await chmod(broken, 0o755)
    const unverified = await fakeInstalled(h, 'epsilon', '1.0.0')
    await mkdir(join(toolRoot(h), 'delta'), { recursive: true })

    const stub = (bin: string, integrity = 'n/a') => ({
      installKind: 'uv-tool' as const,
      requestedPin: 'v1.0.0',
      resolvedVersion: '1.0.0',
      bin,
      integrity,
      installedAt: '2026-08-01T00:00:00Z',
      verifiedAt: '2026-08-01T00:00:00Z',
    })

    await saveToolLock(h, {
      version: 1,
      tools: {
        alpha: stub('/nonexistent/alpha'),
        beta: stub(broken),
        gamma: stub(good),
        epsilon: stub(unverified, 'none'),
      },
    })

    const repo = await makeRepo({
      files: {
        'declawed/SKILL.md':
          '---\nname: declawed\nmetadata:\n  version: 1.0.0\n  deprecated: true\n---\n',
      },
    })
    const repoRef = { id: 'r', path: repo, name: 'r', isGit: false }
    await saveConfig(h, { ...DEFAULT_CONFIG, repos: [repoRef] })

    const report = await doctor({
      home: h,
      skills: await discoverSkills(repoRef),
      ledgerLifecycle: new Map([['r/declawed', 'active']]),
      ruleMap: { applied: RULE_CLASS_MAP_VERSION, current: RULE_CLASS_MAP_VERSION },
    })

    const kind = (id: string): string | undefined =>
      report.tools.find((t) => t.toolId === id)?.kind
    expect(kind('alpha')).toBe('missing')
    expect(kind('beta')).toBe('unverifiable')
    expect(kind('gamma')).toBe('version-drift')
    expect(kind('delta')).toBe('unlocked')
    expect(kind('epsilon')).toBe('integrity-unverified')
    expect(report.lifecycle).toEqual([{ skillId: 'r/declawed', file: 'deprecated', ledger: 'active' }])
    expect(report.failed).toBe(true)
  })
})
