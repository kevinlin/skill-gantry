import { describe, expect, it } from 'vitest'
import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG,
  canonicalisePath,
  loadConfig,
  registerRepo,
  saveConfig,
} from '../../src/core/config/config.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-home-'))

describe('loadConfig', () => {
  it('returns defaults when no file exists', async () => {
    expect(await loadConfig(await home())).toEqual(DEFAULT_CONFIG)
  })

  it('round-trips through save', async () => {
    const h = await home()
    const cfg = { ...DEFAULT_CONFIG, concurrency: 4 }
    await saveConfig(h, cfg)
    expect((await loadConfig(h)).concurrency).toBe(4)
  })

  it('rejects a config that fails validation', async () => {
    const h = await home()
    await saveConfig(h, { ...DEFAULT_CONFIG, concurrency: 0 } as never).catch(() => undefined)
    await expect(saveConfig(h, { ...DEFAULT_CONFIG, concurrency: 0 } as never)).rejects.toThrow()
  })
})

describe('registerRepo', () => {
  it('records a canonical path, name and git flag', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const cfg = await registerRepo(h, root)
    expect(cfg.repos).toHaveLength(1)
    expect(cfg.repos[0]?.path).toBe(await canonicalisePath(root))
    expect(cfg.repos[0]?.isGit).toBe(false)
  })

  it('rejects a path that canonicalises onto an existing repo', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await registerRepo(h, root)
    const link = join(await mkdtemp(join(tmpdir(), 'sg-link-')), 'alias')
    await symlink(root, link)
    await expect(registerRepo(h, link)).rejects.toThrow(/already registered/)
  })

  it('strips a trailing separator before comparing', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await registerRepo(h, root)
    await expect(registerRepo(h, `${root}/`)).rejects.toThrow(/already registered/)
  })

  it('deduplicates ids with a numeric suffix', async () => {
    const h = await home()
    const one = await makeRepo({ files: { 'skills/SKILL.md': SKILL_MD('x') } })
    const two = await makeRepo({ files: { 'skills/SKILL.md': SKILL_MD('y') } })
    await registerRepo(h, join(one, 'skills'))
    const cfg = await registerRepo(h, join(two, 'skills'))
    expect(cfg.repos.map((r) => r.id)).toEqual(['skills', 'skills-2'])
  })
})
