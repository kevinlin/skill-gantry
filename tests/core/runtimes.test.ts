import { describe, expect, it } from 'vitest'
import { catalogueEntry } from '../../src/core/tools/catalogue.js'
import type { Exec } from '../../src/core/tools/exec.js'
import { INSTALL_COMMAND, probeRuntimes, runtimesFor } from '../../src/core/tools/runtimes.js'

const present: Exec = async (bin) => ({ stdout: `${bin} 1.2.3`, stderr: '' })
const absent: Exec = async (bin) => {
  throw Object.assign(new Error(`spawn ${bin} ENOENT`), { code: 'ENOENT' })
}

describe('probeRuntimes', () => {
  it('reports a present runtime with its version', async () => {
    const [uv] = await probeRuntimes(['uv'], present)
    expect(uv).toMatchObject({ runtime: 'uv', present: true, version: '1.2.3' })
  })

  it('reports a missing runtime with the official install command — R3.7', async () => {
    const [uv] = await probeRuntimes(['uv'], absent)
    expect(uv?.present).toBe(false)
    expect(uv?.installCommand).toBe(INSTALL_COMMAND.uv)
  })

  // R3.7 is satisfied structurally: there is no code path that installs.
  it('invokes nothing but the version argv', async () => {
    const calls: string[][] = []
    const record: Exec = async (bin, argv) => {
      calls.push([bin, ...argv])
      return { stdout: '9.9.9', stderr: '' }
    }
    await probeRuntimes(['uv', 'npm'], record)
    expect(calls).toEqual([
      ['uv', '--version'],
      ['npm', '--version'],
    ])
  })

  it('never probes the none runtime', async () => {
    expect(await probeRuntimes(['none'], absent)).toEqual([])
  })

  it('deduplicates', async () => {
    expect(await probeRuntimes(['npm', 'npm'], present)).toHaveLength(1)
  })
})

describe('runtimesFor', () => {
  it('derives the distinct runtimes a selection needs', () => {
    const spector = catalogueEntry('skillspector')
    expect(spector).toBeDefined()
    expect(runtimesFor([spector!])).toEqual(['uv'])
  })
})
