import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadConfig,
  saveConfig,
  saveToolLock,
  DEFAULT_CONFIG,
} from '../../src/core/config/config.js'
import { buildProgram, type CliDeps } from '../../src/cli/run-command.js'
import { buildSetupDriver, needsSetup } from '../../src/cli/setup-command.js'
import { makeRepo, SKILL_MD } from '../helpers/tmp-repo.js'

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-setup-cli-'))

describe('first-run routing', () => {
  it('launches setup when nothing is registered and nothing is locked', async () => {
    const h = await home()
    expect(await needsSetup(h)).toBe(true)
  })

  it('does not launch setup once a repo is registered', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await saveConfig(h, {
      ...DEFAULT_CONFIG,
      repos: [{ id: 'r', path: root, name: 'r', isGit: false }],
    })
    expect(await needsSetup(h)).toBe(false)
  })

  it('routes the bare command to setup on a clean machine and to the TUI otherwise', async () => {
    const h = await home()
    const calls: string[] = []
    const deps: CliDeps = {
      home: h,
      dbPath: ':memory:',
      write: () => {},
      startTui: async () => {
        calls.push('tui')
      },
      startSetup: async () => {
        calls.push('setup')
      },
    }
    await buildProgram(deps).parseAsync(['node', 'skillgantry'])
    expect(calls).toEqual(['setup'])

    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await saveConfig(h, {
      ...DEFAULT_CONFIG,
      repos: [{ id: 'r', path: root, name: 'r', isGit: false }],
    })
    await buildProgram(deps).parseAsync(['node', 'skillgantry'])
    expect(calls).toEqual(['setup', 'tui'])
  })

  it('enters the wizard explicitly even when setup is complete', async () => {
    const h = await home()
    await saveToolLock(h, { version: 1, tools: {} })
    const calls: string[] = []
    const deps: CliDeps = {
      home: h,
      dbPath: ':memory:',
      write: () => {},
      startTui: async () => calls.push('tui') as unknown as void,
      startSetup: async () => calls.push('setup') as unknown as void,
    }
    await buildProgram(deps).parseAsync(['node', 'skillgantry', 'setup'])
    expect(calls).toEqual(['setup'])
  })
})

describe('setup driver', () => {
  it('writes a selection holding only runnable tools, and registers the repo', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const driver = buildSetupDriver(h)

    await driver.saveSelection(['skillspector', 'skill-lint'])
    await driver.registerRepo(root)

    const config = await loadConfig(h)
    expect(config.stageTools.security).toEqual(['skillspector'])
    // skill-lint installs in M3 and gains its parser in M4, so it must not be
    // selected yet: AdapterStageExecutor.plan() throws on an unknown id.
    expect(config.stageTools.validate).toEqual([])
    expect(config.repos.map((r) => r.name)).toEqual([root.split('/').at(-1)])
  })

  it('reports the credential file and its mode warning', async () => {
    const h = await home()
    await mkdir(h, { recursive: true })
    const file = join(h, '.env')
    await writeFile(file, 'ANTHROPIC_AUTH_TOKEN=0123456789abcdef\n')
    await chmod(file, 0o644)
    const status = await buildSetupDriver(h).credentialStatus()
    expect(status.present).toBe(true)
    expect(status.warnings.join(' ')).toMatch(/more permissive than 600/)
  })
})
