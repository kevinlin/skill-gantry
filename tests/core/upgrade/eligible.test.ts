import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveEligibility } from '../../../src/core/index.js'

async function fixture(): Promise<{ home: string; bin: string }> {
  const root = await mkdtemp(join(tmpdir(), 'sg-elig-'))
  return { home: join(root, '.skillgantry'), bin: join(root, 'bin') }
}

describe('resolveEligibility', () => {
  it('accepts a link into the versioned prefix', async () => {
    const { home, bin } = await fixture()
    const target = join(home, 'versions', '0.5.1', 'node_modules', '.bin', 'skillgantry')
    await mkdir(join(home, 'versions', '0.5.1', 'node_modules', '.bin'), { recursive: true })
    await writeFile(target, '#!/usr/bin/env node\n')
    await mkdir(bin, { recursive: true })
    const link = join(bin, 'skillgantry')
    await symlink(target, link)

    const result = await resolveEligibility(link, home)
    expect(result.kind).toBe('owned')
    if (result.kind === 'owned') expect(result.link).toBe(link)
  })

  // The flat prefix predates the versioned layout and is still ours to replace.
  it('accepts a link into the legacy flat prefix', async () => {
    const { home, bin } = await fixture()
    const target = join(home, 'cli', 'node_modules', '.bin', 'skillgantry')
    await mkdir(join(home, 'cli', 'node_modules', '.bin'), { recursive: true })
    await writeFile(target, '#!/usr/bin/env node\n')
    await mkdir(bin, { recursive: true })
    const link = join(bin, 'skillgantry')
    await symlink(target, link)

    expect((await resolveEligibility(link, home)).kind).toBe('owned')
  })

  it('refuses a development working tree and names it', async () => {
    const { home } = await fixture()
    const tree = await mkdtemp(join(tmpdir(), 'sg-dev-'))
    const entry = join(tree, 'dist', 'cli', 'index.js')
    await mkdir(join(tree, 'dist', 'cli'), { recursive: true })
    await writeFile(entry, '')

    const result = await resolveEligibility(entry, home)
    expect(result.kind).toBe('foreign')
    if (result.kind === 'foreign') {
      expect(result.runningFrom).toContain(tree)
      expect(result.advice).toMatch(/install:cli/)
    }
  })

  // Under the prefix but invoked directly: owned bytes, but no link to swing,
  // so adopting a new version would leave this invocation on the old one.
  it('refuses an entry point that is not a symlink', async () => {
    const { home } = await fixture()
    const target = join(home, 'versions', '0.5.1', 'node_modules', '.bin', 'skillgantry')
    await mkdir(join(home, 'versions', '0.5.1', 'node_modules', '.bin'), { recursive: true })
    await writeFile(target, '')

    const result = await resolveEligibility(target, home)
    expect(result.kind).toBe('foreign')
    if (result.kind === 'foreign') expect(result.advice).toMatch(/not through the link/)
  })
})
