import { describe, expect, it, vi } from 'vitest'
import { PRESETS, expandSelection } from '../../src/core/tools/catalogue.js'
import { INSTALL_COMMAND, type RuntimeStatus } from '../../src/core/tools/runtimes.js'
import type { SetupDriver } from '../../src/core/tools/setup.js'
import { makeHeadless, type Headless } from '../helpers/headless.js'

/** What `skillgantry setup --yes --preset minimal` is asked to install. */
const MINIMAL = expandSelection(PRESETS.minimal)

const runtime = (name: 'uv' | 'npm', present = true): RuntimeStatus => ({
  runtime: name,
  present,
  version: present ? '1.0.0' : null,
  installCommand: INSTALL_COMMAND[name],
})

interface SetupDocument {
  preset: string
  applied: boolean
  runtimes: Array<{ runtime: string; present: boolean; installCommand: string }>
  tools: Array<{ id: string; state: string; error?: string; config?: string }>
  credentials: { present: boolean; warnings: string[] }
}

/**
 * Every method a spy, and the three the headless path must never reach
 * throwing: it inspects and registers no repo, because choosing one is the
 * wizard's step and a test that let it through would pass by accident.
 */
function fakeDriver(over: Partial<SetupDriver> = {}): SetupDriver {
  return {
    probe: vi.fn(async () => [runtime('uv'), runtime('npm')]),
    install: vi.fn(async () => undefined),
    configure: vi.fn(async () => ({ kind: 'skipped' as const })),
    saveSelection: vi.fn(async () => undefined),
    credentialStatus: vi.fn(async () => ({ present: false, warnings: [] })),
    inspectRepo: vi.fn(async () => {
      throw new Error('headless setup inspects no repo')
    }),
    registerRepo: vi.fn(async () => {
      throw new Error('headless setup registers no repo')
    }),
    updateRepo: vi.fn(async () => {
      throw new Error('headless setup moves no repo')
    }),
    installedTools: vi.fn(async () => []),
    ...over,
  }
}

const calls = (fn: unknown): unknown[][] => vi.mocked(fn as (...args: unknown[]) => unknown).mock.calls

const setup = (
  h: Headless,
  driver: SetupDriver,
  args: readonly string[],
  over: Parameters<Headless['run']>[1] = {},
): Promise<number> => h.run(['setup', ...args], { setupDriver: () => driver, ...over })

/** Every method that changes something, which is what a dry run must not call. */
const WRITES = ['install', 'configure', 'saveSelection', 'registerRepo', 'updateRepo'] as const

describe('skillgantry setup --yes --preset (R12.18)', () => {
  it('installs the preset in order, saves the selection and exits 0', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver()

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal', '--json'])).toBe(0)

    expect(calls(driver.install)).toEqual(MINIMAL.map((id) => [id]))
    expect(calls(driver.saveSelection)).toEqual([[PRESETS.minimal]])
    const doc = h.json<SetupDocument>()
    expect(doc.preset).toBe('minimal')
    expect(doc.applied).toBe(true)
    expect(doc.tools).toEqual(MINIMAL.map((id) => ({ id, state: 'installed' })))
    expect(h.err).toEqual([])
  })

  it('never mounts the wizard and never asks for a terminal', async () => {
    const h = await makeHeadless()
    const startSetup = vi.fn(async () => undefined)

    expect(
      await setup(h, fakeDriver(), ['--yes', '--preset', 'minimal'], {
        stdinIsTTY: false,
        startSetup,
      }),
    ).toBe(0)

    expect(startSetup).not.toHaveBeenCalled()
  })

  it('attempts every remaining tool after one fails, and writes no selection', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({
      install: vi.fn(async (id: string) => {
        if (id === 'skillspector') throw new Error('download failed\nsecond line')
      }),
    })

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal', '--json'])).toBe(1)

    expect(calls(driver.install)).toEqual(MINIMAL.map((id) => [id]))
    expect(driver.saveSelection).not.toHaveBeenCalled()
    // Configured: what is usable, and nothing the step above just reported failed.
    expect(calls(driver.configure)).toEqual(
      MINIMAL.filter((id) => id !== 'skillspector').map((id) => [id]),
    )
    const doc = h.json<SetupDocument>()
    expect(doc.applied).toBe(false)
    expect(doc.tools.find((tool) => tool.id === 'skillspector')).toEqual({
      id: 'skillspector',
      state: 'failed',
      error: 'download failed\nsecond line',
    })
    expect(doc.tools.filter((tool) => tool.state === 'installed')).toHaveLength(MINIMAL.length - 1)
  })

  it('rejects a missing runtime naming its official command, and installs nothing', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({ probe: vi.fn(async () => [runtime('uv', false), runtime('npm')]) })

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal'])).toBe(2)

    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toMatch(/^error: /)
    expect(h.err[0]).toContain('uv')
    expect(h.err[0]).toContain(INSTALL_COMMAND.uv)
    expect(h.err[0]).not.toContain(INSTALL_COMMAND.npm)
    for (const method of WRITES) expect(driver[method]).not.toHaveBeenCalled()
  })

  it('names every missing runtime when more than one is', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({
      probe: vi.fn(async () => [runtime('uv', false), runtime('npm', false)]),
    })

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal'])).toBe(2)

    expect(h.err[0]).toContain(INSTALL_COMMAND.uv)
    expect(h.err[0]).toContain(INSTALL_COMMAND.npm)
    expect(driver.install).not.toHaveBeenCalled()
  })

  it('without --yes names what it would install, writes nothing and exits 1', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({ installedTools: vi.fn(async () => ['skill-up']) })

    expect(await setup(h, driver, ['--preset', 'minimal', '--json'])).toBe(1)

    for (const method of WRITES) expect(driver[method]).not.toHaveBeenCalled()
    const doc = h.json<SetupDocument>()
    expect(doc.applied).toBe(false)
    expect(doc.tools).toEqual(
      MINIMAL.map((id) => ({ id, state: id === 'skill-up' ? 'present' : 'would-install' })),
    )
  })

  it('without --yes still refuses a missing runtime, since the preset cannot be met here', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({ probe: vi.fn(async () => [runtime('uv', false), runtime('npm')]) })

    expect(await setup(h, driver, ['--preset', 'minimal'])).toBe(2)

    expect(h.err[0]).toContain(INSTALL_COMMAND.uv)
    expect(h.out).toEqual([])
  })

  it('rejects --yes without --preset, before building a driver', async () => {
    const h = await makeHeadless()
    const setupDriver = vi.fn(() => fakeDriver())

    expect(await h.run(['setup', '--yes'], { setupDriver })).toBe(2)

    expect(h.err[0]).toMatch(/^error: .*--preset/)
    expect(setupDriver).not.toHaveBeenCalled()
  })

  it.each([['--yes', '--preset', 'nope'], ['--preset', 'nope'], ['--yes', '--preset', 'toString']])(
    'rejects a preset that is not one of the three: %s',
    async (...args) => {
      const h = await makeHeadless()
      const setupDriver = vi.fn(() => fakeDriver())

      expect(await h.run(['setup', ...args], { setupDriver })).toBe(2)

      expect(h.err[0]).toMatch(/^error: .*minimal.*recommended.*everything/)
      expect(setupDriver).not.toHaveBeenCalled()
    },
  )

  it('skips what is already installed, and installs the rest', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({ installedTools: vi.fn(async () => ['skill-up', 'skills']) })

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal', '--json'])).toBe(0)

    expect(calls(driver.install)).toEqual([['skillspector'], ['skill-upper']])
    expect(h.json<SetupDocument>().tools).toEqual([
      { id: 'skill-up', state: 'present' },
      { id: 'skillspector', state: 'installed' },
      { id: 'skills', state: 'present' },
      { id: 'skill-upper', state: 'installed' },
    ])
    // Present is usable: the selection is written over it all the same.
    expect(calls(driver.saveSelection)).toEqual([[PRESETS.minimal]])
  })

  it('is a no-op the second time: nothing installs and the selection is still written', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({ installedTools: vi.fn(async () => [...MINIMAL]) })

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal'])).toBe(0)

    expect(driver.install).not.toHaveBeenCalled()
    expect(calls(driver.saveSelection)).toEqual([[PRESETS.minimal]])
  })

  it('reports a configure outcome and never fails on one', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({
      configure: vi.fn(async (id: string) =>
        id === 'skillspector'
          ? { kind: 'no-credentials' as const }
          : id === 'skills'
            ? { kind: 'written' as const, path: '/x/settings.json', sha256: 'abc' }
            : { kind: 'skipped' as const },
      ),
    })

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal', '--json'])).toBe(0)

    const tools = h.json<SetupDocument>().tools
    expect(tools.find((tool) => tool.id === 'skillspector')?.config).toBe('no-credentials')
    expect(tools.find((tool) => tool.id === 'skills')?.config).toBe('written')
    // `skipped` is every tool that declares no file; a row for each would say nothing.
    expect(tools.find((tool) => tool.id === 'skill-up')).not.toHaveProperty('config')
    expect(calls(driver.saveSelection)).toEqual([[PRESETS.minimal]])
  })

  it('reports the runtimes it probed and the credential file without writing it', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({
      credentialStatus: vi.fn(async () => ({ present: true, warnings: ['.env is mode 644'] })),
    })

    await setup(h, driver, ['--yes', '--preset', 'minimal', '--json'])

    const doc = h.json<SetupDocument>()
    expect(doc.runtimes).toEqual([
      { runtime: 'uv', present: true, installCommand: INSTALL_COMMAND.uv },
      { runtime: 'npm', present: true, installCommand: INSTALL_COMMAND.npm },
    ])
    expect(doc.credentials).toEqual({ present: true, warnings: ['.env is mode 644'] })
  })

  it('prints one line per tool and one for credentials, without --json', async () => {
    const h = await makeHeadless()
    const driver = fakeDriver({
      install: vi.fn(async (id: string) => {
        if (id === 'skills') throw new Error('registry\nunreachable')
      }),
      configure: vi.fn(async (id: string) =>
        id === 'skillspector'
          ? { kind: 'no-credentials' as const }
          : { kind: 'skipped' as const },
      ),
    })

    expect(await setup(h, driver, ['--yes', '--preset', 'minimal'])).toBe(1)

    expect(h.out).toEqual([
      'skill-up  installed',
      'skillspector  installed  config: no-credentials',
      'skills  failed  registry unreachable',
      'skill-upper  installed',
      'credentials  absent',
    ])
  })

  it('builds the driver with the home and the user home it was given', async () => {
    const h = await makeHeadless()
    const setupDriver = vi.fn(() => fakeDriver())

    await h.run(['setup', '--yes', '--preset', 'minimal'], { setupDriver, userHome: '/tmp/agent-home' })

    expect(setupDriver).toHaveBeenCalledTimes(1)
    expect(setupDriver).toHaveBeenCalledWith(h.home, '/tmp/agent-home')
  })

  it('leaves bare setup the wizard, which still needs a terminal', async () => {
    const h = await makeHeadless()
    const startSetup = vi.fn(async () => undefined)
    const setupDriver = vi.fn(() => fakeDriver())

    expect(await h.run(['setup'], { stdinIsTTY: false, startSetup, setupDriver })).toBe(2)
    expect(await h.run(['setup'], { stdinIsTTY: true, startSetup, setupDriver })).toBe(0)

    expect(startSetup).toHaveBeenCalledTimes(1)
    expect(setupDriver).not.toHaveBeenCalled()
  })
})
