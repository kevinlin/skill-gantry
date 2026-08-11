import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { maybeUpgrade } from '../../src/cli/upgrade-command.js'
import { buildProgram, type CliDeps } from '../../src/cli/run-command.js'
import { loadUpgradeState, saveConfig, DEFAULT_CONFIG } from '../../src/core/index.js'

const CHANGELOG = '# Changelog\n\n## 0.6.0 — 2026-08-14\n- feat: a thing\n'

function fakeFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith('/releases/latest')) {
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

const offline = (async () => {
  throw new Error('offline')
}) as unknown as typeof fetch

interface Harness {
  deps: CliDeps
  lines: string[]
  home: string
  link: string
  root: string
}

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'sg-launch-'))
  const home = join(root, '.skillgantry')
  const prefix = join(home, 'versions', '0.5.1', 'node_modules', '.bin')
  await mkdir(prefix, { recursive: true })
  await writeFile(join(prefix, 'skillgantry'), '#!/bin/sh\n', { mode: 0o755 })
  const bin = join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const link = join(bin, 'skillgantry')
  await symlink(join(prefix, 'skillgantry'), link)

  const lines: string[] = []
  return {
    root,
    home,
    link,
    lines,
    deps: {
      home,
      dbPath: join(home, 'gantry.db'),
      write: (line) => lines.push(line),
    },
  }
}

afterEach(() => {
  delete process.env['SG_UPGRADED_FROM']
})

describe('maybeUpgrade', () => {
  // R13.12. Without this guard, a release whose packed version disagrees with
  // its tag relaunches forever.
  it('returns continue and makes no request when the process is a relaunch', async () => {
    const h = await harness()
    process.env['SG_UPGRADED_FROM'] = '0.5.1'
    const fetchImpl = fakeFetch()

    const result = await maybeUpgrade(h.deps, {
      entryPath: h.link,
      currentVersion: '0.5.1',
      fetchImpl,
    })
    expect(result).toBe('continue')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // R13.11. The check must not block the launch and must not fail it.
  it('returns continue and prints nothing when the check is unreachable', async () => {
    const h = await harness()
    const result = await maybeUpgrade(h.deps, {
      entryPath: h.link,
      currentVersion: '0.5.1',
      fetchImpl: offline,
    })
    expect(result).toBe('continue')
    expect(h.lines).toEqual([])
  })

  it('names an available release once for a foreign install and continues', async () => {
    const h = await harness()
    const stranger = join(h.root, 'elsewhere', 'dist', 'cli', 'index.js')
    await mkdir(join(h.root, 'elsewhere', 'dist', 'cli'), { recursive: true })
    await writeFile(stranger, '')

    const result = await maybeUpgrade(h.deps, {
      entryPath: stranger,
      currentVersion: '0.5.1',
      fetchImpl: fakeFetch(),
    })
    expect(result).toBe('continue')
    expect(h.lines).toHaveLength(1)
    expect(h.lines[0]).toContain('0.6.0')
  })

  it('records the decline on skip and never prompts for that version again', async () => {
    const h = await harness()
    const prompt = vi.fn(async () => 'skip' as const)

    const first = await maybeUpgrade(h.deps, {
      entryPath: h.link,
      currentVersion: '0.5.1',
      fetchImpl: fakeFetch(),
      isTty: true,
      prompt,
    })
    expect(first).toBe('continue')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect((await loadUpgradeState(h.home))?.declinedVersion).toBe('0.6.0')

    const second = await maybeUpgrade(h.deps, {
      entryPath: h.link,
      currentVersion: '0.5.1',
      fetchImpl: fakeFetch(),
      isTty: true,
      prompt,
    })
    expect(second).toBe('continue')
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('does not prompt off a TTY', async () => {
    const h = await harness()
    const prompt = vi.fn(async () => 'upgrade' as const)
    const result = await maybeUpgrade(h.deps, {
      entryPath: h.link,
      currentVersion: '0.5.1',
      fetchImpl: fakeFetch(),
      isTty: false,
      prompt,
    })
    expect(result).toBe('continue')
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe('the root action', () => {
  it('still starts the TUI when maybeUpgrade continues', async () => {
    const h = await harness()
    await saveConfig(h.home, {
      ...DEFAULT_CONFIG,
      repos: [{ id: 'r', name: 'r', path: h.root, isGit: false }],
    })
    await mkdir(join(h.home, 'tools'), { recursive: true })
    await writeFile(
      join(h.home, 'tools', 'lock.json'),
      JSON.stringify({
        version: 1,
        tools: {
          skillspector: {
            installKind: 'uv-tool',
            requestedPin: '1',
            resolvedVersion: '1',
            bin: '/bin/true',
            integrity: 'none',
            installedAt: '2026-01-01T00:00:00Z',
            verifiedAt: '2026-01-01T00:00:00Z',
          },
        },
      }),
    )

    let started = false
    let checked = false
    const program = buildProgram({
      ...h.deps,
      startTui: async () => {
        started = true
      },
      startSetup: async () => {},
      // The offline stand-in for the launch check. `'continue'` is every answer
      // but a completed relaunch, so this is the branch that must still mount.
      maybeUpgrade: async () => {
        checked = true
        return 'continue'
      },
    })
    await program.parseAsync(['node', 'skillgantry'])
    expect(checked).toBe(true)
    expect(started).toBe(true)
  })

  it('does not start the TUI when the launch check relaunched', async () => {
    const h = await harness()
    await saveConfig(h.home, {
      ...DEFAULT_CONFIG,
      repos: [{ id: 'r', name: 'r', path: h.root, isGit: false }],
    })
    await mkdir(join(h.home, 'tools'), { recursive: true })
    await writeFile(
      join(h.home, 'tools', 'lock.json'),
      JSON.stringify({
        version: 1,
        tools: {
          skillspector: {
            installKind: 'uv-tool',
            requestedPin: '1',
            resolvedVersion: '1',
            bin: '/bin/true',
            integrity: 'none',
            installedAt: '2026-01-01T00:00:00Z',
            verifiedAt: '2026-01-01T00:00:00Z',
          },
        },
      }),
    )

    let started = false
    const program = buildProgram({
      ...h.deps,
      startTui: async () => {
        started = true
      },
      startSetup: async () => {},
      maybeUpgrade: async () => 'relaunched',
    })
    await program.parseAsync(['node', 'skillgantry'])
    expect(started).toBe(false)
  })
})
