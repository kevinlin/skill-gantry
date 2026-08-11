import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareSemver } from '../release/version.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { ReleaseInfo } from './types.js'

export type ApplyStep =
  | 'download'
  | 'verify-download'
  | 'install'
  | 'verify-install'
  | 'snapshot'
  | 'relink'
  | 'prune'

export interface ApplyOptions {
  release: ReleaseInfo
  home: string
  /** The symlink to rename over, from `Eligibility`. */
  link: string
  fromVersion: string
  fetchImpl?: typeof fetch
  exec?: Exec
  onProgress?: (step: ApplyStep, detail: string) => void
}

export interface ApplyResult {
  version: string
  prefix: string
  /** `<prefix>/node_modules/skillgantry/dist/cli/index.js` — what the root action spawns. */
  entry: string
}

/** Exactly two: the current version and the one to roll back to. */
const RETAIN = 2

/** The documents a rollback needs, relative to the home. */
const SNAPSHOT_FILES = ['config.json', join('tools', 'lock.json')]

async function download(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const res = await fetchImpl(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: ${url} returned ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * The line-matching shape `gh-release.ts` established: `sha256sum` writes the
 * name bare and `sha256sum -b` writes it with a `*` prefix, and a checksum file
 * that used the other form would otherwise read as "no entry for this asset".
 */
function expectedDigest(sums: string, assetName: string): string {
  const line = sums
    .split('\n')
    .map((raw) => raw.trim().split(/\s+/))
    .find((parts) => parts[1] === assetName || parts[1] === `*${assetName}`)
  if (!line?.[0]) throw new Error(`SHA256SUMS carries no entry for ${assetName}`)
  return line[0]
}

/** Prefixes under `versions/`, newest first; anything unparseable is ignored. */
async function prefixes(versionsRoot: string): Promise<string[]> {
  const entries = await readdir(versionsRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => compareSemver(b, a))
}

/**
 * R13.12. Steps 1–5 build and verify where nothing resolves through the new
 * bytes; step 6 adopts them with one atomic rename. Any failure before that
 * rename leaves the installation byte-identical, which is why this path needs
 * no marker and no journal — there is no partially-updated state to describe,
 * and the previous prefix on disk is the rollback.
 */
export async function applyUpgrade(options: ApplyOptions): Promise<ApplyResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const exec = options.exec ?? defaultExec
  const report = options.onProgress ?? ((): void => {})
  const { version } = options.release

  const versionsRoot = join(options.home, 'versions')
  const prefix = join(versionsRoot, version)
  const staging = join(versionsRoot, `.tmp-${version}`)

  try {
    await mkdir(staging, { recursive: true })

    report('download', `${version} from ${options.release.releaseUrl || 'the release'}`)
    const [tarball, sums] = await Promise.all([
      download(options.release.tarballUrl, fetchImpl),
      download(options.release.sumsUrl, fetchImpl),
    ])

    report('verify-download', 'checksum')
    const assetName = `skillgantry-${version}.tgz`
    const expected = expectedDigest(sums.toString('utf8'), assetName)
    const actual = createHash('sha256').update(tarball).digest('hex')
    if (expected !== actual) {
      throw new Error(`integrity mismatch for ${assetName}: expected ${expected}, got ${actual}`)
    }
    const archive = join(staging, assetName)
    await writeFile(archive, tarball)

    report('install', prefix)
    await mkdir(prefix, { recursive: true })
    await exec('npm', ['install', '--no-audit', '--no-fund', '--prefix', prefix, archive])

    // `install-cli.sh` asserts only a semver shape; here the expected number is
    // known, so the looser check would accept a tarball carrying the wrong
    // release — which is the failure that makes the launch relaunch forever.
    report('verify-install', `${version} --version`)
    const binary = join(prefix, 'node_modules', '.bin', 'skillgantry')
    const { stdout } = await exec(binary, ['--version'])
    const reported = stdout.trim()
    if (reported !== version) {
      throw new Error(`installed ${version} reports ${reported || '(nothing)'}`)
    }

    report('snapshot', join(options.home, 'backup', options.fromVersion))
    const backup = join(options.home, 'backup', options.fromVersion)
    for (const file of SNAPSHOT_FILES) {
      const source = join(options.home, file)
      const target = join(backup, file)
      await mkdir(join(target, '..'), { recursive: true })
      // A home that never wrote one has nothing to preserve, which is not a
      // failure: the snapshot exists for a rollback, not as a precondition.
      await copyFile(source, target).catch(() => undefined)
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    await rm(prefix, { recursive: true, force: true })
    throw error
  }

  // Crash safety is the one thing a unit test cannot prove, so the acceptance
  // suite kills a real child in the window between the last verification and
  // the rename. Unset — every run but that one — this costs one env read.
  if (process.env['SG_UPGRADE_PAUSE_BEFORE_RELINK']) {
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }

  // R13.10. `rename` over an existing symlink is atomic; `ln -sfn` unlinks then
  // symlinks and leaves a window in which no command is on PATH. §12.5's one
  // atomic rename, applied to the binary instead of a baseline file.
  report('relink', options.link)
  const staged = `${options.link}.${process.pid}.tmp`
  await rm(staged, { force: true })
  await symlink(join(prefix, 'node_modules', '.bin', 'skillgantry'), staged)
  await rename(staged, options.link)

  // Past the rename the upgrade has happened. Tidying that fails is cosmetic
  // and must not turn a completed upgrade into a rejection.
  try {
    report('prune', `retaining ${RETAIN}`)
    for (const stale of (await prefixes(versionsRoot)).slice(RETAIN)) {
      await rm(join(versionsRoot, stale), { recursive: true, force: true })
    }
    await rm(staging, { recursive: true, force: true })
    await rm(join(options.home, 'cli'), { recursive: true, force: true })
  } catch (error) {
    report('prune', `left in place: ${(error as Error).message}`)
  }

  return {
    version,
    prefix,
    entry: join(prefix, 'node_modules', 'skillgantry', 'dist', 'cli', 'index.js'),
  }
}
