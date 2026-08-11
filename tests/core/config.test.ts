import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG,
  canonicalisePath,
  inspectRepo,
  loadConfig,
  loadToolLock,
  registerRepo,
  saveConfig,
  updateRepo,
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

  // The raw zod error for a moved version literal names neither number, so a
  // user meeting it has nothing to act on.
  it('names both document versions and the recovery when the version has moved', async () => {
    const h = await home()
    await mkdir(h, { recursive: true })
    await writeFile(join(h, 'config.json'), JSON.stringify({ ...DEFAULT_CONFIG, version: 2 }))

    const error = await loadConfig(h).then(
      () => null,
      (err: Error) => err,
    )
    expect(error?.message).toContain('2')
    expect(error?.message).toContain('1')
    expect(error?.message).toContain('skillgantry upgrade')
    expect(error?.message).toContain('backup')
  })

  it('keeps the zod error for a document malformed any other way', async () => {
    const h = await home()
    await mkdir(h, { recursive: true })
    await writeFile(join(h, 'config.json'), JSON.stringify({ ...DEFAULT_CONFIG, concurrency: 0 }))

    await expect(loadConfig(h)).rejects.not.toThrow(/skillgantry upgrade/)
    await expect(loadConfig(h)).rejects.toThrow()
  })
})

describe('loadToolLock', () => {
  it('names both document versions when the lock version has moved', async () => {
    const h = await home()
    await mkdir(join(h, 'tools'), { recursive: true })
    await writeFile(join(h, 'tools', 'lock.json'), JSON.stringify({ version: 2, tools: {} }))

    const error = await loadToolLock(h).then(
      () => null,
      (err: Error) => err,
    )
    expect(error?.message).toContain('lock.json')
    expect(error?.message).toContain('skillgantry upgrade')
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

describe('updateRepo', () => {
  it('moves a repo to a new path under the id it already had', async () => {
    const h = await home()
    const from = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const to = await makeRepo({ files: { 'b/SKILL.md': SKILL_MD('b') } })
    const { repos } = await registerRepo(h, from)
    const id = repos[0]?.id as string

    const cfg = await updateRepo(h, id, to)
    expect(cfg.repos).toHaveLength(1)
    expect(cfg.repos[0]?.id).toBe(id)
    expect(cfg.repos[0]?.path).toBe(await canonicalisePath(to))
    expect((await loadConfig(h)).repos[0]?.path).toBe(await canonicalisePath(to))
  })

  it('refuses a path that is not a directory, naming it', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const { repos } = await registerRepo(h, root)
    await expect(updateRepo(h, repos[0]?.id as string, '/tmp/definitely-not-here-9f3a')).rejects.toThrow(
      /no such directory/,
    )
  })

  it('refuses a path another repo already holds', async () => {
    const h = await home()
    const one = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const two = await makeRepo({ files: { 'b/SKILL.md': SKILL_MD('b') } })
    await registerRepo(h, one)
    const cfg = await registerRepo(h, two)
    await expect(updateRepo(h, cfg.repos[1]?.id as string, one)).rejects.toThrow(
      /already registered/,
    )
  })

  it('accepts the repo its own path, so a prefilled field can be submitted', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const { repos } = await registerRepo(h, root)
    const cfg = await updateRepo(h, repos[0]?.id as string, root)
    expect(cfg.repos).toEqual(repos)
  })

  it('refuses an id that is not registered', async () => {
    const h = await home()
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    await expect(updateRepo(h, 'nope', root)).rejects.toThrow('no such repo: nope')
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
