import { describe, expect, it } from 'vitest'
import { mkdtemp, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG,
  canonicalisePath,
  inspectRepo,
  loadConfig,
  registerRepo,
  saveConfig,
} from '../../src/core/config/config.js'
import { withRepo } from '../../src/core/config/edit.js'
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

describe('canonicalisePath', () => {
  it('expands ~ rather than treating it as a directory name', async () => {
    // `resolve()` alone turned this into `<cwd>/~/dev`, which registered a
    // repo that could never hold a skill.
    expect(await canonicalisePath('~/dev')).toBe(join(await canonicalisePath(homedir()), 'dev'))
    expect(await canonicalisePath('~')).toBe(await canonicalisePath(homedir()))
  })

  it('leaves a ~ that is not a home shorthand alone', async () => {
    expect(await canonicalisePath('/tmp/~backup')).toBe('/tmp/~backup')
  })

  it('trims surrounding whitespace, which a paste carries', async () => {
    expect(await canonicalisePath('  /tmp  ')).toBe(await canonicalisePath('/tmp'))
  })
})

describe('inspectRepo', () => {
  it('counts the skills a path holds without registering it', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a'), 'b/SKILL.md': SKILL_MD('b') } })
    const found = await inspectRepo(h, root)
    expect(found).toMatchObject({ isDirectory: true, alreadyRegistered: false, skillCount: 2 })
    expect((await loadConfig(h)).repos).toHaveLength(0)
  })

  it('reports a missing path instead of throwing', async () => {
    const seen = await inspectRepo(await home(), '/tmp/definitely-not-here-9f3a')
    expect(seen.isDirectory).toBe(false)
    expect(seen.skillCount).toBe(0)
  })

  it('reports an empty directory as registrable but empty', async () => {
    const root = await makeRepo({ files: {} })
    expect(await inspectRepo(await home(), root)).toMatchObject({
      isDirectory: true,
      skillCount: 0,
    })
  })

  it('flags a path already in the config', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await registerRepo(h, root)
    expect((await inspectRepo(h, root)).alreadyRegistered).toBe(true)
  })
})

describe('registerRepo', () => {
  it('refuses a path that is not a directory, naming it', async () => {
    await expect(registerRepo(await home(), '/tmp/definitely-not-here-9f3a')).rejects.toThrow(
      /no such directory/,
    )
  })

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

describe('registerRepo parity with the staged edit path', () => {
  it('registers through the same rules the staged path uses', async () => {
    const h = await home()
    const repo = await makeRepo({ files: { 'alpha/SKILL.md': SKILL_MD('alpha') } })
    const written = await registerRepo(h, repo)
    const entry = written.repos[0]!
    const staged = withRepo(DEFAULT_CONFIG, { path: entry.path, isGit: entry.isGit })

    expect(written.repos).toEqual(staged.repos)
  })
})
