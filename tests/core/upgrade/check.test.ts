import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkForUpgrade, loadUpgradeState, saveUpgradeState } from '../../../src/core/index.js'

const CHANGELOG =
  '# Changelog\n\n## 0.6.0 — 2026-08-14\n- feat: a thing\n\n## 0.5.1 — 2026-08-10\n- fix: another\n'

function fakeFetch(tag = 'v0.6.0'): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/releases/latest')) {
      return new Response(
        JSON.stringify({
          tag_name: tag,
          published_at: '2026-08-14T10:00:00Z',
          html_url: 'https://example.test/release',
          assets: [
            {
              name: `skillgantry-${tag.slice(1)}.tgz`,
              browser_download_url: 'https://example.test/t.tgz',
            },
            { name: 'SHA256SUMS', browser_download_url: 'https://example.test/SHA256SUMS' },
            { name: 'CHANGELOG.md', browser_download_url: 'https://example.test/CHANGELOG.md' },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response(CHANGELOG, { status: 200 })
  }) as unknown as typeof fetch
}

const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-check-'))
const T0 = Date.parse('2026-08-11T09:00:00.000Z')

describe('checkForUpgrade', () => {
  it('reports a newer release with the entries above the running version', async () => {
    const result = await checkForUpgrade({
      home: await home(),
      currentVersion: '0.5.1',
      now: T0,
      fetchImpl: fakeFetch(),
    })
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      expect(result.release.version).toBe('0.6.0')
      expect(result.release.entries.map((e) => e.version)).toEqual(['0.6.0'])
    }
  })

  it('reports current when the release is not newer', async () => {
    const result = await checkForUpgrade({
      home: await home(),
      currentVersion: '0.6.0',
      now: T0,
      fetchImpl: fakeFetch(),
    })
    expect(result.kind).toBe('current')
  })

  it('skips the network inside the throttle window', async () => {
    const dir = await home()
    const fetchImpl = fakeFetch()
    await checkForUpgrade({ home: dir, currentVersion: '0.5.1', now: T0, fetchImpl })
    const again = await checkForUpgrade({
      home: dir,
      currentVersion: '0.5.1',
      now: T0 + 60_000,
      fetchImpl,
    })
    expect(again.kind).toBe('available') // still prompts, from cache
    expect(fetchImpl).toHaveBeenCalledTimes(2) // one release + one changelog, from the first call only
  })

  it('checks again once the window has passed', async () => {
    const dir = await home()
    const fetchImpl = fakeFetch()
    await checkForUpgrade({ home: dir, currentVersion: '0.5.1', now: T0, fetchImpl })
    await checkForUpgrade({
      home: dir,
      currentVersion: '0.5.1',
      now: T0 + 25 * 3600_000,
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  // A failed request must not buy 24 hours of silence.
  it('reports unreachable and does not record the attempt', async () => {
    const dir = await home()
    const failing = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const result = await checkForUpgrade({
      home: dir,
      currentVersion: '0.5.1',
      now: T0,
      fetchImpl: failing,
    })
    expect(result.kind).toBe('unreachable')
    expect(await loadUpgradeState(dir)).toBeNull()
  })

  it('reports unreachable on a non-ok response', async () => {
    const bad = (async () =>
      new Response('rate limited', { status: 403 })) as unknown as typeof fetch
    const result = await checkForUpgrade({
      home: await home(),
      currentVersion: '0.5.1',
      now: T0,
      fetchImpl: bad,
    })
    expect(result.kind).toBe('unreachable')
  })

  it('honours a recorded decline', async () => {
    const dir = await home()
    await saveUpgradeState(dir, {
      lastCheckedAt: new Date(T0).toISOString(),
      declinedVersion: '0.6.0',
      latest: null,
    })
    const result = await checkForUpgrade({
      home: dir,
      currentVersion: '0.5.1',
      now: T0 + 25 * 3600_000,
      fetchImpl: fakeFetch(),
    })
    expect(result.kind).toBe('declined')
  })

  it('prompts again for a version above the declined one', async () => {
    const dir = await home()
    await saveUpgradeState(dir, {
      lastCheckedAt: new Date(T0).toISOString(),
      declinedVersion: '0.6.0',
      latest: null,
    })
    const result = await checkForUpgrade({
      home: dir,
      currentVersion: '0.5.1',
      now: T0 + 25 * 3600_000,
      fetchImpl: fakeFetch('v0.7.0'),
    })
    expect(result.kind).toBe('available')
  })

  it('force ignores both the throttle and the decline', async () => {
    const dir = await home()
    await saveUpgradeState(dir, {
      lastCheckedAt: new Date(T0).toISOString(),
      declinedVersion: '0.6.0',
      latest: null,
    })
    const fetchImpl = fakeFetch()
    const result = await checkForUpgrade({
      home: dir,
      currentVersion: '0.5.1',
      now: T0,
      force: true,
      fetchImpl,
    })
    expect(result.kind).toBe('available')
    expect(fetchImpl).toHaveBeenCalled()
  })

  // A check that found nothing must not leave the throttled path reporting a
  // version it never saw.
  it('caches latest: null when nothing is newer', async () => {
    const dir = await home()
    await checkForUpgrade({ home: dir, currentVersion: '0.6.0', now: T0, fetchImpl: fakeFetch() })
    expect((await loadUpgradeState(dir))?.latest).toBeNull()
    const again = await checkForUpgrade({
      home: dir,
      currentVersion: '0.6.0',
      now: T0 + 60_000,
      fetchImpl: fakeFetch(),
    })
    expect(again.kind).toBe('current')
  })

  it('reports unreachable when a required asset is missing rather than throwing', async () => {
    const noSums = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v0.6.0',
            published_at: '2026-08-14T10:00:00Z',
            html_url: 'https://example.test/release',
            assets: [
              {
                name: 'skillgantry-0.6.0.tgz',
                browser_download_url: 'https://example.test/t.tgz',
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(CHANGELOG, { status: 200 })
    }) as unknown as typeof fetch

    const result = await checkForUpgrade({
      home: await home(),
      currentVersion: '0.5.1',
      now: T0,
      fetchImpl: noSums,
    })
    expect(result.kind).toBe('unreachable')
  })
})
