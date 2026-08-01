import { createHash } from 'node:crypto'
import { chmod, mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Integrity } from '../adapters/types.js'
import { type Exec, defaultExec } from './exec.js'

export interface GhReleaseInstallSpec {
  id: string
  kind: 'gh-release'
  repo: string
  pin: string
  assetPattern: string
  binName: string
  integrity: Integrity
}

export interface GhReleaseOptions {
  /** Overridden in tests to point at a local server. */
  apiBase?: string
  fetchImpl?: typeof fetch
  exec?: Exec
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/** A fixed pattern cannot match a per-platform asset on two machines. */
export function resolveAssetPattern(pattern: string, platform: string, arch: string): string {
  return pattern
    .replaceAll('{os}', platform)
    .replaceAll('{arch}', arch === 'arm64' ? 'arm64' : 'amd64')
}

async function download(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const res = await fetchImpl(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: ${url} returned ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const hash = (body: Buffer): string => createHash('sha256').update(body).digest('hex')

/**
 * `none` is a recorded standing condition rather than a silent one: it needs a
 * written reason, lands in the lock as `"none"`, and doctor surfaces it.
 */
async function verifyIntegrity(
  spec: GhReleaseInstallSpec,
  assetName: string,
  body: Buffer,
  assets: readonly ReleaseAsset[],
  fetchImpl: typeof fetch,
): Promise<string> {
  const actual = hash(body)
  if (spec.integrity.kind === 'none') return 'none'
  if (spec.integrity.kind === 'sha256-digest') {
    if (actual !== spec.integrity.digest) {
      throw new Error(
        `integrity mismatch for ${spec.id}@${spec.pin}: expected ${spec.integrity.digest}, got ${actual}`,
      )
    }
    return `sha256:${actual}`
  }
  const pattern = new RegExp(spec.integrity.assetPattern)
  const sumsAsset = assets.find((asset) => pattern.test(asset.name))
  if (!sumsAsset) {
    throw new Error(`no checksum asset matching ${spec.integrity.assetPattern} on ${spec.pin}`)
  }
  const sums = (await download(sumsAsset.browser_download_url, fetchImpl)).toString('utf8')
  const line = sums
    .split('\n')
    .map((raw) => raw.trim().split(/\s+/))
    .find((parts) => parts[1] === assetName || parts[1] === `*${assetName}`)
  if (!line?.[0]) throw new Error(`${sumsAsset.name} carries no entry for ${assetName}`)
  if (line[0] !== actual) {
    throw new Error(
      `integrity mismatch for ${spec.id}@${spec.pin}: expected ${line[0]}, got ${actual}`,
    )
  }
  return `sha256:${actual}`
}

/** Depth-limited: release layouts are flat or one directory deep. */
async function findBin(root: string, binName: string, depth = 3): Promise<string | null> {
  const direct = join(root, binName)
  try {
    if ((await stat(direct)).isFile()) return direct
  } catch {
    // keep walking
  }
  if (depth === 0) return null
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const found = await findBin(join(root, entry.name), binName, depth - 1)
    if (found) return found
  }
  return null
}

export async function ghReleaseInstall(
  dir: string,
  spec: GhReleaseInstallSpec,
  options: GhReleaseOptions = {},
): Promise<{ bin: string; integrity: string }> {
  const apiBase = options.apiBase ?? 'https://api.github.com'
  const fetchImpl = options.fetchImpl ?? fetch
  const exec = options.exec ?? defaultExec

  const res = await fetchImpl(`${apiBase}/repos/${spec.repo}/releases/tags/${spec.pin}`, {
    headers: { accept: 'application/vnd.github+json' },
  })
  if (!res.ok) {
    throw new Error(`install failed for ${spec.id}@${spec.pin}: release lookup ${res.status}`)
  }
  const { assets = [] } = (await res.json()) as { assets?: ReleaseAsset[] }

  const pattern = new RegExp(resolveAssetPattern(spec.assetPattern, process.platform, process.arch))
  const asset = assets.find((candidate) => pattern.test(candidate.name))
  if (!asset) {
    throw new Error(`no asset matching ${pattern.source} on ${spec.repo}@${spec.pin}`)
  }

  const body = await download(asset.browser_download_url, fetchImpl)
  const integrity = await verifyIntegrity(spec, asset.name, body, assets, fetchImpl)

  const extractRoot = join(dir, 'extract')
  const binDir = join(dir, 'bin')
  await mkdir(extractRoot, { recursive: true })
  await mkdir(binDir, { recursive: true })

  if (/\.(tar\.gz|tgz)$/.test(asset.name)) {
    const archive = join(dir, asset.name)
    await writeFile(archive, body)
    await exec('tar', ['-xzf', archive, '-C', extractRoot])
  } else if (asset.name.endsWith('.zip')) {
    const archive = join(dir, asset.name)
    await writeFile(archive, body)
    await exec('unzip', ['-q', '-o', archive, '-d', extractRoot])
  } else {
    // A bare binary asset, which some Go releases publish.
    await writeFile(join(extractRoot, spec.binName), body)
  }

  const found = await findBin(extractRoot, spec.binName)
  if (!found) throw new Error(`${asset.name} contains no ${spec.binName}`)
  const bin = join(binDir, spec.binName)
  await rename(found, bin)
  await chmod(bin, 0o755)
  return { bin, integrity }
}
