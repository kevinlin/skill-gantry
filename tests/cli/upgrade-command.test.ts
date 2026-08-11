import { mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UPGRADE_EXIT, runUpgrade } from '../../src/cli/upgrade-command.js'
import { buildProgram, type CliDeps } from '../../src/cli/run-command.js'
import { saveUpgradeState } from '../../src/core/index.js'

const CHANGELOG = '# Changelog\n\n## 0.6.0 — 2026-08-14\n- feat: a thing\n'

function fakeFetch(version = '0.6.0'): typeof fetch {
  return (async (input: string | URL | Request) => {
    if (String(input).endsWith('/releases/latest')) {
      return new Response(
        JSON.stringify({
          tag_name: `v${version}`,
          published_at: '2026-08-14T10:00:00Z',
          html_url: 'https://example.test/release',
          assets: [
            {
              name: `skillgantry-${version}.tgz`,
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
  const root = await mkdtemp(join(tmpdir(), 'sg-upg-cli-'))
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
      startTui: async () => {},
      startSetup: async () => {},
    },
  }
}

const versionsIn = async (home: string): Promise<string[]> =>
  readdir(join(home, 'versions')).catch(() => [])

describe('skillgantry upgrade', () => {
  it('is registered on the program with its three flags', () => {
    const program = buildProgram({
      home: '/nowhere',
      dbPath: '/nowhere/gantry.db',
      write: () => {},
    })
    const command = program.commands.find((candidate) => candidate.name() === 'upgrade')
    expect(command).toBeDefined()
    const flags = command?.options.map((option) => option.long) ?? []
    expect(flags).toEqual(expect.arrayContaining(['--yes', '--json', '--check']))
  })

  it('--check exits 0 when the running build is current', async () => {
    const h = await harness()
    const code = await runUpgrade(
      h.deps,
      { check: true },
      { entryPath: h.link, currentVersion: '0.6.0', fetchImpl: fakeFetch() },
    )
    expect(code).toBe(UPGRADE_EXIT.ok)
  })

  it('--check exits 1 for an available upgrade and installs nothing', async () => {
    const h = await harness()
    const code = await runUpgrade(
      h.deps,
      { check: true },
      { entryPath: h.link, currentVersion: '0.5.1', fetchImpl: fakeFetch() },
    )
    expect(code).toBe(UPGRADE_EXIT.available)
    expect(await versionsIn(h.home)).toEqual(['0.5.1'])
    expect(h.lines.join('\n')).toContain('0.6.0')
  })

  it('exits 2 for a foreign install and prints the advice', async () => {
    const h = await harness()
    const stranger = join(h.root, 'elsewhere', 'dist', 'cli', 'index.js')
    await mkdir(join(h.root, 'elsewhere', 'dist', 'cli'), { recursive: true })
    await writeFile(stranger, '')

    const code = await runUpgrade(
      h.deps,
      { yes: true },
      { entryPath: stranger, currentVersion: '0.5.1', fetchImpl: fakeFetch() },
    )
    expect(code).toBe(UPGRADE_EXIT.foreign)
    expect(h.lines.join('\n')).toMatch(/install:cli|npx skillgantry/)
    expect(await versionsIn(h.home)).toEqual(['0.5.1'])
  })

  it('exits 3 when the check cannot be made', async () => {
    const h = await harness()
    const code = await runUpgrade(
      h.deps,
      { check: true },
      { entryPath: h.link, currentVersion: '0.5.1', fetchImpl: offline },
    )
    expect(code).toBe(UPGRADE_EXIT.unreachable)
  })

  // R12.4's rule for every mutating headless path.
  it('exits 6 without --yes off a TTY, having installed nothing', async () => {
    const h = await harness()
    const code = await runUpgrade(
      h.deps,
      {},
      { entryPath: h.link, currentVersion: '0.5.1', fetchImpl: fakeFetch(), isTty: false },
    )
    expect(code).toBe(UPGRADE_EXIT.unauthorised)
    expect(h.lines.join('\n')).toContain('0.6.0')
    expect(await versionsIn(h.home)).toEqual(['0.5.1'])
  })

  it('--json prints one parseable document naming both versions and the entries', async () => {
    const h = await harness()
    const code = await runUpgrade(
      h.deps,
      { check: true, json: true },
      { entryPath: h.link, currentVersion: '0.5.1', fetchImpl: fakeFetch() },
    )
    expect(code).toBe(UPGRADE_EXIT.available)
    const document = JSON.parse(h.lines.join('\n')) as {
      current: string
      latest: string | null
      entries: { version: string }[]
    }
    expect(document.current).toBe('0.5.1')
    expect(document.latest).toBe('0.6.0')
    expect(document.entries.map((entry) => entry.version)).toEqual(['0.6.0'])
  })

  // R12.10: an explicit command answering from a decline would be useless.
  it('ignores a recorded decline', async () => {
    const h = await harness()
    await saveUpgradeState(h.home, {
      lastCheckedAt: new Date().toISOString(),
      declinedVersion: '0.6.0',
      latest: null,
    })
    const code = await runUpgrade(
      h.deps,
      { check: true },
      { entryPath: h.link, currentVersion: '0.5.1', fetchImpl: fakeFetch() },
    )
    expect(code).toBe(UPGRADE_EXIT.available)
  })
})
