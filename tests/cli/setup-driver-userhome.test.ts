import { homedir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { buildSetupDriver } from '../../src/cli/setup-command.js'
import { catalogueEntry } from '../../src/core/tools/catalogue.js'
import { installTool } from '../../src/core/tools/install.js'

// The one seam `buildSetupDriver` has to `installTool` is its third argument,
// and a real install would clone from the network, so the call is the thing
// observed. Nothing here reaches `~/.claude`: the stand-in returns at once.
vi.mock('../../src/core/tools/install.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/tools/install.js')>()
  return { ...actual, installTool: vi.fn(async () => ({}) as never) }
})

describe('buildSetupDriver — install', () => {
  it('hands installTool the user home it was built with', async () => {
    // A git-skill install links into `<userHome>/.claude/skills`. Without this
    // forwarded, a test under a temporary SG_HOME linked into the developer's
    // own, because `installTool` fell back to `os.homedir()`.
    const driver = buildSetupDriver('/tmp/sg-home', '/tmp/agent-home')

    await driver.install('skill-upper')

    expect(installTool).toHaveBeenCalledWith(
      '/tmp/sg-home',
      catalogueEntry('skill-upper'),
      expect.objectContaining({ userHome: '/tmp/agent-home' }),
    )
  })

  it('still hands over the real home when none was given', async () => {
    vi.mocked(installTool).mockClear()

    await buildSetupDriver('/tmp/sg-home').install('skill-upper')

    expect(installTool).toHaveBeenCalledWith(
      '/tmp/sg-home',
      catalogueEntry('skill-upper'),
      expect.objectContaining({ userHome: homedir() }),
    )
  })
})
