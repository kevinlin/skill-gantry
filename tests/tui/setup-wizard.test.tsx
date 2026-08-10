import { describe, expect, it } from 'vitest'
import { renderInk } from '../helpers/render-ink.js'
import { SetupApp } from '../../src/tui/setup-app.js'
import type { SetupDriver } from '../../src/core/index.js'

function fakeDriver(over: Partial<SetupDriver> = {}): { driver: SetupDriver; installed: string[] } {
  const installed: string[] = []
  const driver: SetupDriver = {
    probe: async () => [
      { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'curl uv | sh' },
      { runtime: 'npm', present: true, version: '11.0.0', installCommand: 'nodejs.org' },
    ],
    install: async (toolId) => {
      installed.push(toolId)
    },
    configure: async () => ({ kind: 'skipped' }),
    saveSelection: async () => {},
    credentialStatus: async () => ({ present: true, warnings: [] }),
    inspectRepo: async (path) => ({
      resolved: path.replace(/^~/, '/home/u'),
      isDirectory: true,
      alreadyRegistered: false,
      skillCount: 20,
      isGit: true,
    }),
    registerRepo: async () => {},
    installedTools: async () => [],
    ...over,
  }
  return { driver, installed }
}

/** Drives the wizard to the repo step, which is the last one before `done`. */
async function atRepoStep(driver: SetupDriver) {
  const ink = renderInk(<SetupApp driver={driver} />)
  await ink.settle(40)
  ink.stdin.send('\r') // probe-runtimes -> select-tools
  await ink.settle(20)
  ink.stdin.send('1') // minimal preset
  await ink.settle(20)
  ink.stdin.send('\r') // -> install-and-verify, which installs
  await ink.settle(150)
  ink.stdin.send('\r') // -> credentials-and-repo
  await ink.settle(40)
  return ink
}

const type = async (ink: Awaited<ReturnType<typeof atRepoStep>>, text: string): Promise<void> => {
  for (const char of text) ink.stdin.send(char)
  await ink.settle(200)
}

describe('setup wizard', () => {
  it('probes on mount and shows each runtime', async () => {
    const { driver } = fakeDriver()
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    expect(ink.lastFrame()).toContain('uv')
    expect(ink.lastFrame()).toContain('0.7.12')
    ink.unmount()
  })

  it('shows the official install command for a missing runtime and never installs it', async () => {
    const { driver } = fakeDriver({
      probe: async () => [
        { runtime: 'uv', present: false, version: null, installCommand: 'curl -LsSf … | sh' },
      ],
    })
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    expect(ink.lastFrame()).toContain('curl -LsSf … | sh')
    ink.unmount()
  })

  it('takes a preset and installs every tool in it', async () => {
    const { driver, installed } = fakeDriver()
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r') // probe-runtimes -> select-tools
    await ink.settle(20)
    ink.stdin.send('1') // minimal preset
    await ink.settle(20)
    ink.stdin.send('\r') // select-tools -> install-and-verify, which installs
    await ink.settle(120)
    expect(installed).toContain('skillspector')
    ink.unmount()
  })

  it('reports a failed install without leaving the state', async () => {
    const { driver } = fakeDriver({
      install: async (toolId) => {
        throw new Error(`no such pin for ${toolId}`)
      },
    })
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(120)
    expect(ink.lastFrame()).toContain('failed')
    expect(ink.lastFrame()).toContain('no such pin')
    ink.unmount()
  })

  it('reports the tool-owned configuration on the install row, naming the path only', async () => {
    const TOKEN = 'sk-0123456789abcdef0123456789abcdef'
    const { driver } = fakeDriver({
      configure: async () => ({
        kind: 'written',
        path: '/home/u/.skillhone/settings.json',
        sha256: 'a'.repeat(64),
      }),
    })
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(120)

    expect(ink.lastFrame()).toContain('settings.json written')
    // The path and never the document: the inline wizard leaves its frames in
    // scrollback, which is the last place a credential should end up.
    expect(ink.lastFrame()).not.toContain(TOKEN)
    ink.unmount()
  })

  it('never configures a tool whose install failed', async () => {
    const asked: string[] = []
    const { driver } = fakeDriver({
      install: async () => {
        throw new Error('no such pin')
      },
      configure: async (toolId) => {
        asked.push(toolId)
        return { kind: 'skipped' }
      },
    })
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(120)

    expect(asked).toEqual([])
    ink.unmount()
  })

  it('goes back to reselect without losing the selection', async () => {
    const { driver } = fakeDriver()
    const ink = renderInk(<SetupApp driver={driver} />)
    await ink.settle(40)
    ink.stdin.send('\r')
    await ink.settle(20)
    ink.stdin.send('1')
    await ink.settle(20)
    ink.stdin.send('\r')
    await ink.settle(120)
    ink.stdin.send('b')
    await ink.settle(20)
    expect(ink.lastFrame()).toContain('Select tools')
    ink.unmount()
  })
})

describe('setup wizard — add repo', () => {
  it('echoes the path as it is typed', async () => {
    const { driver } = fakeDriver()
    const ink = await atRepoStep(driver)
    await type(ink, '/tmp/skills')
    expect(ink.lastFrame()).toContain('/tmp/skills')
    ink.unmount()
  })

  it('takes a pasted path as one chunk rather than dropping it', async () => {
    const { driver } = fakeDriver()
    const ink = await atRepoStep(driver)
    // A terminal paste arrives whole; the per-character path never sees it.
    ink.stdin.send('[200~/Users/me/dev/skills[201~')
    await ink.settle(200)
    expect(ink.lastFrame()).toContain('/Users/me/dev/skills')
    ink.unmount()
  })

  it('shows what the path resolves to and how many skills are in it', async () => {
    const { driver } = fakeDriver()
    const ink = await atRepoStep(driver)
    await type(ink, '~/dev/skills')
    expect(ink.lastFrame()).toContain('/home/u/dev/skills')
    expect(ink.lastFrame()).toContain('20 skills found')
    ink.unmount()
  })

  it('warns about an empty repo but still registers it', async () => {
    const registered: string[] = []
    const { driver } = fakeDriver({
      inspectRepo: async (path) => ({
        resolved: path,
        isDirectory: true,
        alreadyRegistered: false,
        skillCount: 0,
      }),
      registerRepo: async (path) => void registered.push(path),
    })
    const ink = await atRepoStep(driver)
    await type(ink, '/tmp/empty')
    expect(ink.lastFrame()).toContain('no skills found here')
    ink.stdin.send('\r')
    await ink.settle(60)
    expect(registered).toEqual(['/tmp/empty'])
    expect(ink.lastFrame()).toContain('Done')
    ink.unmount()
  })

  it('names a path that is not a directory', async () => {
    const { driver } = fakeDriver({
      inspectRepo: async (path) => ({
        resolved: path,
        isDirectory: false,
        alreadyRegistered: false,
        skillCount: 0,
      }),
    })
    const ink = await atRepoStep(driver)
    await type(ink, '/tmp/nope')
    expect(ink.lastFrame()).toContain('no such directory')
    ink.unmount()
  })

  it('reports a rejected registration instead of dying on it', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown): void => void unhandled.push(err)
    process.on('unhandledRejection', onUnhandled)
    const { driver } = fakeDriver({
      registerRepo: async (path) => {
        throw new Error(`already registered: ${path}`)
      },
    })
    const ink = await atRepoStep(driver)
    await type(ink, '/tmp/dupe')
    ink.stdin.send('\r')
    await ink.settle(80)

    expect(ink.lastFrame()).toContain('already registered: /tmp/dupe')
    // Still on the step, so the user can correct the path.
    expect(ink.lastFrame()).toContain('Credentials and repo')
    expect(unhandled).toEqual([])
    process.off('unhandledRejection', onUnhandled)
    ink.unmount()
  })

  it('says why enter did nothing when no path has been typed', async () => {
    const { driver } = fakeDriver()
    const ink = await atRepoStep(driver)
    ink.stdin.send('\r')
    await ink.settle(40)
    expect(ink.lastFrame()).toContain('type a repo path first')
    ink.unmount()
  })

  it('finishes without a repo on ctrl-d', async () => {
    const registered: string[] = []
    const { driver } = fakeDriver({ registerRepo: async (p) => void registered.push(p) })
    const ink = await atRepoStep(driver)
    ink.stdin.send('')
    await ink.settle(40)
    expect(ink.lastFrame()).toContain('No repo registered')
    expect(registered).toEqual([])
    ink.unmount()
  })

  it('shows the step counter and rail rather than the internal state name', async () => {
    const { driver } = fakeDriver()
    const ink = await atRepoStep(driver)
    expect(ink.lastFrame()).toContain('step 4 of 5')
    expect(ink.lastFrame()).not.toContain('(credentials-and-repo)')
    ink.unmount()
  })
})
