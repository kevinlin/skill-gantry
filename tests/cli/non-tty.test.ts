import { describe, expect, it, vi } from 'vitest'
import { makeHeadless } from '../helpers/headless.js'

describe('R12.14 — no terminal, no interface', () => {
  it('refuses the root action with 2, naming the headless commands, without mounting the TUI', async () => {
    const h = await makeHeadless()
    const startTui = vi.fn(async () => undefined)
    const startSetup = vi.fn(async () => undefined)

    expect(await h.run([], { stdinIsTTY: false, startTui, startSetup })).toBe(2)

    expect(startTui).not.toHaveBeenCalled()
    expect(startSetup).not.toHaveBeenCalled()
    expect(h.err).toHaveLength(1)
    for (const name of ['list', 'status', '--help']) expect(h.err[0]).toContain(name)
    expect(h.err[0]).toMatch(/^error: /)
  })

  it('refuses before the first-run wizard too, on a machine with nothing registered', async () => {
    const h = await makeHeadless({ repos: [] })
    const startTui = vi.fn(async () => undefined)
    const startSetup = vi.fn(async () => undefined)

    expect(await h.run([], { stdinIsTTY: false, startTui, startSetup })).toBe(2)

    expect(startSetup).not.toHaveBeenCalled()
    expect(startTui).not.toHaveBeenCalled()
  })

  it('refuses setup with 2 without starting the wizard', async () => {
    const h = await makeHeadless()
    const startSetup = vi.fn(async () => undefined)

    expect(await h.run(['setup'], { stdinIsTTY: false, startSetup })).toBe(2)

    expect(startSetup).not.toHaveBeenCalled()
    expect(h.err).toHaveLength(1)
    for (const name of ['list', 'status', '--help']) expect(h.err[0]).toContain(name)
  })

  it('refuses when standard input is not a terminal by default, which is what a spawned agent has', async () => {
    const h = await makeHeadless()
    const startTui = vi.fn(async () => undefined)
    // vitest's own standard input is not a terminal, so the unset default is
    // the non-terminal case.
    expect(process.stdin.isTTY === true).toBe(false)
    expect(await h.run([], { startTui })).toBe(2)
    expect(startTui).not.toHaveBeenCalled()
  })

  it('still launches the TUI and the wizard when standard input is a terminal', async () => {
    const h = await makeHeadless()
    const startTui = vi.fn(async () => undefined)
    const startSetup = vi.fn(async () => undefined)

    expect(await h.run([], { stdinIsTTY: true, startTui, startSetup })).toBe(0)
    expect(startTui).toHaveBeenCalledTimes(1)

    expect(await h.run(['setup'], { stdinIsTTY: true, startTui, startSetup })).toBe(0)
    expect(startSetup).toHaveBeenCalledTimes(1)
    expect(h.err).toEqual([])
  })

  it('does not touch the release index on a refused launch', async () => {
    const h = await makeHeadless()
    const maybeUpgrade = vi.fn(async () => 'continue' as const)
    await h.run([], { stdinIsTTY: false, startTui: async () => undefined, maybeUpgrade })
    expect(maybeUpgrade).not.toHaveBeenCalled()
  })
})
