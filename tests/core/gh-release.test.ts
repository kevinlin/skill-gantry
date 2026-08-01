import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  type GhReleaseInstallSpec,
  ghReleaseInstall,
  resolveAssetPattern,
} from '../../src/core/tools/gh-release.js'
import { sha256, startFakeRelease } from '../helpers/fake-release.js'

const run = promisify(execFile)

/** A tar.gz holding one executable, built the way a real release publishes one. */
async function tarball(binName: string): Promise<Buffer> {
  const stage = await mkdtemp(join(tmpdir(), 'sg-rel-'))
  await mkdir(join(stage, 'pkg'), { recursive: true })
  const bin = join(stage, 'pkg', binName)
  await writeFile(bin, '#!/bin/sh\necho "skill-up 0.4.2"\n')
  await chmod(bin, 0o755)
  await run('tar', ['-czf', join(stage, 'asset.tar.gz'), '-C', join(stage, 'pkg'), binName])
  return readFile(join(stage, 'asset.tar.gz'))
}

const spec = (over: Partial<GhReleaseInstallSpec> = {}): GhReleaseInstallSpec => ({
  id: 'skill-up',
  kind: 'gh-release',
  repo: 'acme/skill-up',
  pin: 'v0.4.2',
  assetPattern: 'skill-up_.*\\.tar\\.gz',
  binName: 'skill-up',
  integrity: { kind: 'none', reason: 'upstream publishes no checksums' },
  ...over,
})

describe('resolveAssetPattern', () => {
  it('substitutes host tokens before matching', () => {
    expect(resolveAssetPattern('sk_{os}_{arch}\\.tar\\.gz', 'darwin', 'arm64')).toBe(
      'sk_darwin_arm64\\.tar\\.gz',
    )
    expect(resolveAssetPattern('sk_{os}_{arch}\\.tar\\.gz', 'linux', 'x64')).toBe(
      'sk_linux_amd64\\.tar\\.gz',
    )
  })
})

describe('ghReleaseInstall', () => {
  it('extracts the asset and resolves the declared binary', async () => {
    const body = await tarball('skill-up')
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [{ name: 'skill-up_darwin_arm64.tar.gz', body }],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      const out = await ghReleaseInstall(dir, spec(), { apiBase: release.apiBase })
      expect(out.bin.startsWith(dir)).toBe(true)
      expect((await run(out.bin, [])).stdout).toContain('skill-up 0.4.2')
      expect(out.integrity).toBe('none')
    } finally {
      await release.close()
    }
  })

  it('accepts a matching pinned digest', async () => {
    const body = await tarball('skill-up')
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [{ name: 'skill-up_darwin_arm64.tar.gz', body }],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      const out = await ghReleaseInstall(
        dir,
        spec({ integrity: { kind: 'sha256-digest', digest: sha256(body) } }),
        { apiBase: release.apiBase },
      )
      expect(out.integrity).toBe(`sha256:${sha256(body)}`)
    } finally {
      await release.close()
    }
  })

  it('fails the install on a digest mismatch — R3.2b', async () => {
    const body = await tarball('skill-up')
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [{ name: 'skill-up_darwin_arm64.tar.gz', body }],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      await expect(
        ghReleaseInstall(
          dir,
          spec({ integrity: { kind: 'sha256-digest', digest: 'a'.repeat(64) } }),
          {
            apiBase: release.apiBase,
          },
        ),
      ).rejects.toThrow(/integrity mismatch/)
    } finally {
      await release.close()
    }
  })

  it('verifies against a published checksum asset', async () => {
    const body = await tarball('skill-up')
    const name = 'skill-up_darwin_arm64.tar.gz'
    const sums = Buffer.from(`${sha256(body)}  ${name}\n0000  other.tar.gz\n`)
    const release = await startFakeRelease({
      repo: 'acme/skill-up',
      tag: 'v0.4.2',
      assets: [
        { name, body },
        { name: 'checksums.txt', body: sums },
      ],
    })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      const out = await ghReleaseInstall(
        dir,
        spec({ integrity: { kind: 'sha256-asset', assetPattern: 'checksums\\.txt' } }),
        { apiBase: release.apiBase },
      )
      expect(out.integrity).toBe(`sha256:${sha256(body)}`)
    } finally {
      await release.close()
    }
  })

  it('names the pattern when no asset matches', async () => {
    const release = await startFakeRelease({ repo: 'acme/skill-up', tag: 'v0.4.2', assets: [] })
    const dir = await mkdtemp(join(tmpdir(), 'sg-gh-'))
    try {
      await expect(ghReleaseInstall(dir, spec(), { apiBase: release.apiBase })).rejects.toThrow(
        /no asset matching/,
      )
    } finally {
      await release.close()
    }
  })
})
