import { describe, expect, it } from 'vitest'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadConfig } from '../../src/core/config/config.js'
import { makeHeadless } from '../helpers/headless.js'
import { SKILL_MD_FULL, makeGitRepo, makeRepo } from '../helpers/tmp-repo.js'

describe('skillgantry repo add', () => {
  it('registers a path and prints the repo and its skill count under --json', async () => {
    const h = await makeHeadless({ repos: [] })
    const path = await makeGitRepo({
      files: { 'a/SKILL.md': SKILL_MD_FULL('a'), 'b/SKILL.md': SKILL_MD_FULL('b') },
    })

    expect(await h.run(['repo', 'add', path, '--json'])).toBe(0)

    const real = await realpath(path)
    expect(h.json()).toEqual({
      repo: { id: basename(real), path: real, name: basename(real), isGit: true },
      skills: 2,
    })
    expect((await loadConfig(h.home)).repos.map((r) => r.path)).toEqual([real])
    expect(h.err).toEqual([])
  })

  it('makes the registered skills appear in list', async () => {
    const h = await makeHeadless({ repos: [] })
    const path = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD_FULL('a') } })
    expect(await h.run(['repo', 'add', path])).toBe(0)

    h.out.length = 0
    expect(await h.run(['list', '--json'])).toBe(0)
    const { skills } = h.json<{ skills: Array<{ id: string }> }>()
    expect(skills.map((s) => s.id)).toEqual([`${basename(await realpath(path))}/a`])
  })

  it('prints one readable line without --json', async () => {
    const h = await makeHeadless({ repos: [] })
    const path = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD_FULL('a') } })
    expect(await h.run(['repo', 'add', path])).toBe(0)
    expect(h.out).toHaveLength(1)
    expect(h.out[0]).toContain(basename(await realpath(path)))
    expect(h.out[0]).toMatch(/1 skill\b/)
  })

  it('refuses a duplicate with 2 and writes nothing', async () => {
    const h = await makeHeadless()
    const before = await readFile(join(h.home, 'config.json'), 'utf8')

    expect(await h.run(['repo', 'add', h.repos[0]!])).toBe(2)

    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toMatch(/^error: already registered: /)
    expect(h.out).toEqual([])
    expect(await readFile(join(h.home, 'config.json'), 'utf8')).toBe(before)
  })

  it('adds the document under --json for a duplicate', async () => {
    const h = await makeHeadless()
    expect(await h.run(['repo', 'add', h.repos[0]!, '--json'])).toBe(2)
    expect(h.out).toHaveLength(1)
    expect(JSON.parse(h.out[0] as string)).toHaveProperty('error.message')
  })

  it('refuses a path that is not a directory with 2 and writes nothing', async () => {
    const h = await makeHeadless()
    const before = await readFile(join(h.home, 'config.json'), 'utf8')
    const file = join(h.repos[0]!, 'sk', 'SKILL.md')

    expect(await h.run(['repo', 'add', file])).toBe(2)

    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toMatch(/^error: no such directory: /)
    expect(await readFile(join(h.home, 'config.json'), 'utf8')).toBe(before)
  })

  it('refuses a path that does not exist, leaving no config behind', async () => {
    const h = await makeHeadless({ repos: [] })
    const config = join(h.home, 'config.json')
    await writeFile(config, `${JSON.stringify(await loadConfig(h.home))}\n`)
    const before = await readFile(config, 'utf8')

    expect(await h.run(['repo', 'add', join(h.home, 'missing')])).toBe(2)

    expect(await readFile(config, 'utf8')).toBe(before)
  })

  it('needs a path', async () => {
    const h = await makeHeadless()
    expect(await h.run(['repo', 'add'])).toBe(2)
    expect(h.err[0]).toContain("missing required argument 'path'")
  })
})
