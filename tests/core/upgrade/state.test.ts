import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareSemver, loadUpgradeState, saveUpgradeState } from '../../../src/core/index.js'

describe('compareSemver', () => {
  it('orders by major, minor then patch', () => {
    expect(compareSemver('0.6.0', '0.5.1')).toBeGreaterThan(0)
    expect(compareSemver('0.5.1', '0.6.0')).toBeLessThan(0)
    expect(compareSemver('0.5.1', '0.5.1')).toBe(0)
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })

  it('ranks a release above a prerelease of the same numbers', () => {
    expect(compareSemver('0.6.0', '0.6.0-rc.1')).toBeGreaterThan(0)
  })

  it('throws on an unparseable version rather than sorting it', () => {
    expect(() => compareSemver('latest', '0.5.1')).toThrow(/latest/)
  })
})

describe('upgrade state', () => {
  it('reads back what it wrote', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-state-'))
    await saveUpgradeState(home, {
      lastCheckedAt: '2026-08-11T09:00:00.000Z',
      declinedVersion: '0.6.0',
      latest: null,
    })
    expect(await loadUpgradeState(home)).toEqual({
      lastCheckedAt: '2026-08-11T09:00:00.000Z',
      declinedVersion: '0.6.0',
      latest: null,
    })
    expect(await readFile(join(home, 'upgrade.json'), 'utf8')).toContain('declinedVersion')
  })

  it('returns null for an absent file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-state-'))
    expect(await loadUpgradeState(home)).toBeNull()
  })

  // A corrupt cache must never be the reason a launch fails: it is a cache.
  it('returns null for an unparseable file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-state-'))
    await saveUpgradeState(home, { lastCheckedAt: 'x', declinedVersion: null, latest: null })
    await writeFile(join(home, 'upgrade.json'), '{ not json')
    expect(await loadUpgradeState(home)).toBeNull()
  })
})
