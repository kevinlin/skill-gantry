import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeLabel, startTui } from '../../src/cli/tui-command.js'
import { DEFAULT_CONFIG, saveConfig } from '../../src/core/config/config.js'

const { rendered } = vi.hoisted(() => ({ rendered: [] as Array<Record<string, unknown>> }))

// The terminal itself is not under test: what `startTui` hands it is.
vi.mock('../../src/tui/index.js', () => ({
  renderApp: async (props: Record<string, unknown>) => {
    rendered.push(props)
  },
}))

afterEach(() => {
  rendered.length = 0
  vi.unstubAllEnvs()
})

describe('homeLabel', () => {
  const user = '/Users/keli'

  it('is absent for the default home, which is the one nobody needs reminding of', () => {
    expect(homeLabel('/Users/keli/.skillgantry', user)).toBeUndefined()
    // Spelled with a trailing slash or a dot segment, it is still that directory.
    expect(homeLabel('/Users/keli/.skillgantry/', user)).toBeUndefined()
    expect(homeLabel('/Users/keli/./.skillgantry', user)).toBeUndefined()
  })

  it('shortens the user’s home to `~`', () => {
    expect(homeLabel('/Users/keli/work/sg-home', user)).toBe('~/work/sg-home')
    expect(homeLabel('/Users/keli', user)).toBe('~')
  })

  it('leaves a home outside the user’s as the absolute path it is', () => {
    expect(homeLabel('/opt/skillgantry', user)).toBe('/opt/skillgantry')
  })

  it('does not shorten a sibling that merely shares the user’s prefix', () => {
    // `/Users/keliana` is not under `/Users/keli`; `~ana/…` would name a
    // different person's directory.
    expect(homeLabel('/Users/keliana/.skillgantry', user)).toBe('/Users/keliana/.skillgantry')
  })

  it('treats the default under another user’s home as non-default', () => {
    expect(homeLabel('/Users/other/.skillgantry', user)).toBe('/Users/other/.skillgantry')
  })

  it('is the default home that `~/.skillgantry` names, not whatever SG_HOME points at', () => {
    // SG_HOME relocates the home, and a relocated home is exactly the case the
    // label exists for: it must not read as the default because it was chosen.
    vi.stubEnv('SG_HOME', '/Users/keli/.skillgantry')
    expect(homeLabel('/srv/shared/skillgantry', user)).toBe('/srv/shared/skillgantry')
  })
})

describe('startTui', () => {
  async function launch(home: string): Promise<Record<string, unknown>> {
    await mkdir(home, { recursive: true })
    await saveConfig(home, DEFAULT_CONFIG)
    await startTui({ home, dbPath: join(home, 'gantry.db') })
    expect(rendered).toHaveLength(1)
    return rendered[0] as Record<string, unknown>
  }

  it('passes the home through renderApp when it is not the default', async () => {
    const home = join(await realpath(await mkdtemp(join(tmpdir(), 'sg-label-'))), 'elsewhere')
    const props = await launch(home)
    expect(props['homeLabel']).toBe(home)
  })

  it('shortens the user’s home in what it passes', async () => {
    const user = await realpath(await mkdtemp(join(tmpdir(), 'sg-user-')))
    vi.stubEnv('HOME', user)
    const props = await launch(join(user, 'work', 'sg-home'))
    expect(props['homeLabel']).toBe('~/work/sg-home')
  })

  it('passes no label at all for the default home, rather than an empty one', async () => {
    const user = await realpath(await mkdtemp(join(tmpdir(), 'sg-user-')))
    vi.stubEnv('HOME', user)
    const props = await launch(join(user, '.skillgantry'))
    expect('homeLabel' in props).toBe(false)
  })
})
