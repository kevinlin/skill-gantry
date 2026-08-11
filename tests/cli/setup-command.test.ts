import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadConfig,
  loadToolLock,
  saveConfig,
  saveToolLock,
  DEFAULT_CONFIG,
} from '../../src/core/config/config.js'
import { RELEASE_TOOL_ID, SKILLHONE_TOOL_ID } from '../../src/core/tools/catalogue.js'
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
      // The launch check reaches the release index; the default suite is
      // offline, so the root action's seam stands in for it.
      maybeUpgrade: async () => 'continue',
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

    await driver.saveSelection(['skillspector', 'skill-lint', RELEASE_TOOL_ID])
    await driver.registerRepo(root)

    const config = await loadConfig(h)
    expect(config.stageTools.security).toEqual(['skillspector'])
    expect(config.stageTools.validate).toEqual(['skill-lint'])
    // The release installer has stage null and no adapter by design (R3.5b), so
    // it never reaches stageTools however it is selected.
    expect(Object.values(config.stageTools).flat()).not.toContain(RELEASE_TOOL_ID)
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

describe('configure — the SkillHone settings file (R3.10)', () => {
  const TOKEN = 'sk-0123456789abcdef0123456789abcdef'
  const ENV_TEXT = [
    'ANTHROPIC_BASE_URL=https://gateway.test/anthropic',
    `ANTHROPIC_AUTH_TOKEN=${TOKEN}`,
    'ANTHROPIC_MODEL=a-model',
    '',
  ].join('\n')

  const seed = async (): Promise<{ h: string; u: string }> => {
    const h = await home()
    const u = await home()
    await writeFile(join(h, '.env'), ENV_TEXT)
    await saveToolLock(h, {
      version: 1,
      tools: {
        [SKILLHONE_TOOL_ID]: {
          installKind: 'git-skill',
          requestedPin: 'a'.repeat(40),
          resolvedVersion: 'a'.repeat(40),
          bin: join(h, 'tools', SKILLHONE_TOOL_ID, '.venv', 'bin', 'python'),
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    })
    return { h, u }
  }

  it('writes the file and records its path and digest in the lock', async () => {
    const { h, u } = await seed()
    const outcome = await buildSetupDriver(h, u).configure(SKILLHONE_TOOL_ID)
    if (outcome.kind !== 'written') throw new Error(`expected a write, got ${outcome.kind}`)

    const recorded = (await loadToolLock(h)).tools[SKILLHONE_TOOL_ID]?.config
    expect(recorded?.path).toBe(outcome.path)
    expect(recorded?.sha256).toBe(outcome.sha256)
    // The digest and never the document: the file holds a credential, a hash
    // of it does not.
    expect(JSON.stringify(recorded)).not.toContain(TOKEN)
  })

  it('leaves a file it did not write, and records nothing for it', async () => {
    const { h, u } = await seed()
    await mkdir(join(u, '.skillhone'), { recursive: true })
    await writeFile(join(u, '.skillhone', 'settings.json'), '{"hand":"written"}\n')

    expect((await buildSetupDriver(h, u).configure(SKILLHONE_TOOL_ID)).kind).toBe('exists')
    expect((await loadToolLock(h)).tools[SKILLHONE_TOOL_ID]?.config).toBeUndefined()
  })

  it('reports a missing credential rather than writing a file that authenticates against nothing', async () => {
    const h = await home()
    const u = await home()
    expect((await buildSetupDriver(h, u).configure(SKILLHONE_TOOL_ID)).kind).toBe('no-credentials')
  })

  it('skips every tool that declares no configuration file', async () => {
    const { h, u } = await seed()
    expect((await buildSetupDriver(h, u).configure('skill-lint')).kind).toBe('skipped')
  })
})
