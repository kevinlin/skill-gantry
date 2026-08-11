import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { cp, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { withDistributionLock } from '../helpers/distribution-lock.js'

const run = promisify(execFile)

/**
 * The two properties a unit test cannot reach: a real npm install adopted by a
 * real rename, and a process killed inside the window before that rename.
 * `tests/acceptance/m5.test.ts`'s precedent — crash safety is proved by killing
 * a child, never by fabricating the state it would have left.
 */

interface Release {
  server: Server
  origin: string
  version: string
}

const stop = async (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()))

/**
 * A local release: this working tree packed at a bumped version, served with a
 * `releases/latest` document, its checksum file and its changelog, all under
 * the names the client looks for by exact match.
 */
async function publish(version: string): Promise<Release> {
  const staging = await mkdtemp(join(tmpdir(), 'sg-m9-release-'))
  const source = await mkdtemp(join(tmpdir(), 'sg-m9-src-'))

  // `package.json` declares `files: ["dist"]`, so a packable copy is the
  // manifest plus that one directory — and `VERSION` reads the manifest, so
  // bumping it is what makes the packed build answer `--version` with the new
  // number. The checkout itself is never touched: it is the build under test.
  // Under the same lock as every other read of `dist/`: the packaging and
  // local-install suites recompile into this checkout, and a copy racing one of
  // their builds would ship a truncated module as the release.
  const manifest = await withDistributionLock(async () => {
    await cp(join(process.cwd(), 'dist'), join(source, 'dist'), { recursive: true })
    return JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
  })
  manifest['version'] = version
  await writeFile(join(source, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  await run('npm', ['pack', '--pack-destination', staging], { cwd: source })
  const tarballName = `skillgantry-${version}.tgz`
  const tarball = await readFile(join(staging, tarballName))
  const sums = `${createHash('sha256').update(tarball).digest('hex')}  ${tarballName}\n`
  const changelog = `# Changelog\n\n## ${version} — 2026-08-14\n- feat: the released thing\n`

  const server = createServer((request, response) => {
    const url = request.url ?? ''
    if (url.endsWith('/releases/latest')) {
      const origin = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          tag_name: `v${version}`,
          published_at: '2026-08-14T10:00:00Z',
          html_url: `${origin}/release`,
          assets: [
            { name: tarballName, browser_download_url: `${origin}/${tarballName}` },
            { name: 'SHA256SUMS', browser_download_url: `${origin}/SHA256SUMS` },
            { name: 'CHANGELOG.md', browser_download_url: `${origin}/CHANGELOG.md` },
          ],
        }),
      )
      return
    }
    if (url.endsWith('SHA256SUMS')) {
      response.writeHead(200).end(sums)
      return
    }
    if (url.endsWith('CHANGELOG.md')) {
      response.writeHead(200).end(changelog)
      return
    }
    if (url.endsWith(tarballName)) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(tarball)
      return
    }
    response.writeHead(404).end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
  return { server, origin, version }
}

interface Installed {
  home: string
  binDir: string
  link: string
  version: string
}

/** A real `install-cli.sh` into a throwaway home. */
async function installHere(): Promise<Installed> {
  const home = await mkdtemp(join(tmpdir(), 'sg-m9-home-'))
  const binDir = await mkdtemp(join(tmpdir(), 'sg-m9-bin-'))
  await withDistributionLock(() =>
    run('scripts/install-cli.sh', [], {
      cwd: process.cwd(),
      env: { ...process.env, SG_HOME: home, SG_BIN_DIR: binDir },
    }),
  )
  const link = join(binDir, 'skillgantry')
  const { stdout } = await run(link, ['--version'])
  return { home, binDir, link, version: stdout.trim() }
}

const bump = (version: string): string => {
  const [major = '0', minor = '0'] = version.split('.')
  return `${major}.${String(Number(minor) + 1)}.0`
}

let servers: Server[] = []
afterEach(async () => {
  for (const server of servers) await stop(server)
  servers = []
})

describe('M9 exit criteria', () => {
  it('upgrades a real install end to end, retains the previous prefix and snapshots the config', async () => {
    const installed = await installHere()
    const release = await publish(bump(installed.version))
    servers.push(release.server)

    await writeFile(join(installed.home, 'config.json'), '{"version":1,"repos":[]}\n')

    const { stdout } = await run(installed.link, ['upgrade', '--yes'], {
      env: {
        ...process.env,
        SG_HOME: installed.home,
        SG_UPGRADE_API_BASE: release.origin,
        SG_UPGRADE_REPO: 'local/test',
      },
    })
    expect(stdout).toContain(release.version)

    const resolved = await realpath(installed.link)
    expect(resolved).toContain(join('versions', release.version))

    const reported = await run(installed.link, ['--version'])
    expect(reported.stdout.trim()).toBe(release.version)

    const prefixes = await readdir(join(installed.home, 'versions'))
    expect(prefixes).toContain(installed.version)
    expect(prefixes).toContain(release.version)

    const snapshot = await readFile(
      join(installed.home, 'backup', installed.version, 'config.json'),
      'utf8',
    )
    expect(snapshot).toContain('"version"')

    await rm(installed.home, { recursive: true, force: true })
    await rm(installed.binDir, { recursive: true, force: true })
  }, 600_000)

  it('leaves the installation on the old version when killed before the relink', async () => {
    const installed = await installHere()
    const release = await publish(bump(installed.version))
    servers.push(release.server)

    const before = await readlink(installed.link)

    const child = spawn(installed.link, ['upgrade', '--yes'], {
      env: {
        ...process.env,
        SG_HOME: installed.home,
        SG_UPGRADE_API_BASE: release.origin,
        SG_UPGRADE_REPO: 'local/test',
        SG_UPGRADE_PAUSE_BEFORE_RELINK: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // The kill lands in the window R13.12 is about: both verifications have
    // passed and nothing the running installation resolves through has moved.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('never reached verify-install'))
      }, 300_000)
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('verify-install')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.on('exit', () => {
        clearTimeout(timer)
        reject(new Error('exited before the relink window'))
      })
    })
    child.kill('SIGKILL')
    await new Promise<void>((resolve) => child.on('exit', () => resolve()))

    expect(await readlink(installed.link)).toBe(before)
    const reported = await run(installed.link, ['--version'])
    expect(reported.stdout.trim()).toBe(installed.version)

    await rm(installed.home, { recursive: true, force: true })
    await rm(installed.binDir, { recursive: true, force: true })
  }, 600_000)
})
