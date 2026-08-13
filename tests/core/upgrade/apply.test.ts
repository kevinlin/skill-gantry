import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyUpgrade, type ApplyStep, type Exec, type ReleaseInfo } from '../../../src/core/index.js'

const TARBALL = Buffer.from('not really a tarball, npm is faked below')
const digest = (body: Buffer): string => createHash('sha256').update(body).digest('hex')

const release = (version = '0.6.0'): ReleaseInfo => ({
  version,
  publishedAt: '2026-08-14T10:00:00Z',
  tarballUrl: 'https://example.test/t.tgz',
  sumsUrl: 'https://example.test/SHA256SUMS',
  releaseUrl: 'https://example.test/release',
  entries: [{ version, lines: ['feat: a thing'] }],
})

function serve(sums: string, body = TARBALL): typeof fetch {
  return (async (input: string | URL | Request) => {
    if (String(input).endsWith('SHA256SUMS')) return new Response(sums, { status: 200 })
    return new Response(body, { status: 200 })
  }) as unknown as typeof fetch
}

const goodSums = (version = '0.6.0'): string =>
  `${digest(TARBALL)}  skillgantry-${version}.tgz\n`

/**
 * What `sha256sum ./*.tgz` writes — the form every release up to 0.6.4 actually
 * published, and the one a bare-name matcher read as "no entry for this asset".
 */
const dotSlashSums = (version = '0.6.0'): string =>
  `${digest(TARBALL)}  ./skillgantry-${version}.tgz\n`

// The fake Exec stands in for npm: it creates the tree npm would create, so
// every assertion below is about apply's ordering rather than about npm.
function fakeNpm(version: string, reported = version): Exec {
  return async (_bin, argv) => {
    const prefix = argv[argv.indexOf('--prefix') + 1] as string
    const bin = join(prefix, 'node_modules', '.bin')
    await mkdir(join(prefix, 'node_modules', 'skillgantry', 'dist', 'cli'), { recursive: true })
    await writeFile(join(prefix, 'node_modules', 'skillgantry', 'dist', 'cli', 'index.js'), '')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'skillgantry'), `#!/bin/sh\necho ${reported}\n`, { mode: 0o755 })
    return { stdout: '', stderr: '' }
  }
}

/** A version binary whose `--version` answers whatever the fake npm wrote. */
const reportingExec =
  (version: string, reported = version): Exec =>
  async (bin, argv) => {
    if (argv[0] === '--version') return { stdout: `${reported}\n`, stderr: '' }
    return fakeNpm(version, reported)(bin, argv)
  }

/** A home with an installed 0.5.1 and a link on PATH pointing into it. */
async function installed(from = '0.5.1'): Promise<{ home: string; link: string }> {
  const root = await mkdtemp(join(tmpdir(), 'sg-apply-'))
  const home = join(root, '.skillgantry')
  const prefix = join(home, 'versions', from, 'node_modules', '.bin')
  await mkdir(prefix, { recursive: true })
  await writeFile(join(prefix, 'skillgantry'), '#!/bin/sh\n', { mode: 0o755 })
  await mkdir(join(home, 'tools'), { recursive: true })
  await writeFile(join(home, 'config.json'), '{"version":1}\n')
  await writeFile(join(home, 'tools', 'lock.json'), '{"version":1}\n')

  const bin = join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const link = join(bin, 'skillgantry')
  await symlink(join(prefix, 'skillgantry'), link)
  return { home, link }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('applyUpgrade', () => {
  it('installs, verifies, snapshots, relinks and reports every step in order', async () => {
    const { home, link } = await installed()
    const steps: ApplyStep[] = []

    const result = await applyUpgrade({
      release: release(),
      home,
      link,
      fromVersion: '0.5.1',
      fetchImpl: serve(goodSums()),
      exec: reportingExec('0.6.0'),
      onProgress: (step) => steps.push(step),
    })

    expect(await exists(join(home, 'versions', '0.6.0'))).toBe(true)
    expect(await realpath(link)).toContain(join('versions', '0.6.0'))
    expect(await exists(join(home, 'backup', '0.5.1', 'config.json'))).toBe(true)
    expect(await exists(join(home, 'backup', '0.5.1', 'tools', 'lock.json'))).toBe(true)
    expect(result.entry.endsWith(join('dist', 'cli', 'index.js'))).toBe(true)
    expect(steps).toEqual([
      'download',
      'verify-download',
      'install',
      'verify-install',
      'snapshot',
      'relink',
      'prune',
    ])
  })

  it('verifies against a checksum file that names the tarball with a ./ prefix', async () => {
    const { home, link } = await installed()

    await applyUpgrade({
      release: release(),
      home,
      link,
      fromVersion: '0.5.1',
      fetchImpl: serve(dotSlashSums()),
      exec: reportingExec('0.6.0'),
    })

    expect(await realpath(link)).toContain(join('versions', '0.6.0'))
  })

  it('leaves the installation byte-identical when the checksum does not match', async () => {
    const { home, link } = await installed()
    const before = await realpath(link)

    await expect(
      applyUpgrade({
        release: release(),
        home,
        link,
        fromVersion: '0.5.1',
        fetchImpl: serve(`${'0'.repeat(64)}  skillgantry-0.6.0.tgz\n`),
        exec: reportingExec('0.6.0'),
      }),
    ).rejects.toThrow(/integrity/i)

    expect(await exists(join(home, 'versions', '0.6.0'))).toBe(false)
    expect(await realpath(link)).toBe(before)
    const staged = await readdir(join(home, 'versions'))
    expect(staged.filter((name) => name.startsWith('.tmp-'))).toEqual([])
  })

  it('refuses a build whose installed binary reports another version', async () => {
    const { home, link } = await installed()
    const before = await realpath(link)

    await expect(
      applyUpgrade({
        release: release(),
        home,
        link,
        fromVersion: '0.5.1',
        fetchImpl: serve(goodSums()),
        exec: reportingExec('0.6.0', '0.5.1'),
      }),
    ).rejects.toThrow(/0\.6\.0.*0\.5\.1|0\.5\.1.*0\.6\.0/)

    expect(await realpath(link)).toBe(before)
  })

  // The snapshot has to precede the relink or a rollback finds the documents
  // the new version rewrote.
  it('snapshots before it relinks', async () => {
    const { home, link } = await installed()
    const steps: ApplyStep[] = []
    await applyUpgrade({
      release: release(),
      home,
      link,
      fromVersion: '0.5.1',
      fetchImpl: serve(goodSums()),
      exec: reportingExec('0.6.0'),
      onProgress: (step) => steps.push(step),
    })
    expect(steps.indexOf('snapshot')).toBeLessThan(steps.indexOf('relink'))
  })

  it('retains exactly the current and the previous prefix', async () => {
    const { home, link } = await installed()
    for (const old of ['0.3.0', '0.4.0']) {
      await mkdir(join(home, 'versions', old), { recursive: true })
    }

    await applyUpgrade({
      release: release(),
      home,
      link,
      fromVersion: '0.5.1',
      fetchImpl: serve(goodSums()),
      exec: reportingExec('0.6.0'),
    })

    expect((await readdir(join(home, 'versions'))).sort()).toEqual(['0.5.1', '0.6.0'])
  })

  it('removes a legacy flat prefix only after a successful relink', async () => {
    const { home, link } = await installed()
    await mkdir(join(home, 'cli', 'node_modules'), { recursive: true })

    await applyUpgrade({
      release: release(),
      home,
      link,
      fromVersion: '0.5.1',
      fetchImpl: serve(goodSums()),
      exec: reportingExec('0.6.0'),
    })
    expect(await exists(join(home, 'cli'))).toBe(false)

    const second = await installed()
    await mkdir(join(second.home, 'cli', 'node_modules'), { recursive: true })
    await expect(
      applyUpgrade({
        release: release(),
        home: second.home,
        link: second.link,
        fromVersion: '0.5.1',
        fetchImpl: serve(`${'0'.repeat(64)}  skillgantry-0.6.0.tgz\n`),
        exec: reportingExec('0.6.0'),
      }),
    ).rejects.toThrow()
    expect(await exists(join(second.home, 'cli'))).toBe(true)
  })
})
