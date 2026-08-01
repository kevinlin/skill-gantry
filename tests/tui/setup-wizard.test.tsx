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
    saveSelection: async () => {},
    credentialStatus: async () => ({ present: true, warnings: [] }),
    registerRepo: async () => {},
    ...over,
  }
  return { driver, installed }
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
