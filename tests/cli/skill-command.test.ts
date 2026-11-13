import { describe, expect, it } from 'vitest'
import { isAbsolute, join } from 'node:path'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { BUNDLED_MARKER, VERSION } from '../../src/core/index.js'
import { makeHeadless } from '../helpers/headless.js'

const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-skill-cmd-'))

describe('skillgantry skill install', () => {
  it('copies the bundled skill into <dir>/skillgantry and reports it under --json', async () => {
    const h = await makeHeadless()
    const dir = await scratch()

    expect(await h.run(['skill', 'install', '--dir', dir, '--json'])).toBe(0)

    const path = join(dir, 'skillgantry')
    expect(h.json()).toEqual({ installed: [{ path, version: VERSION, replaced: false }] })
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toContain('name: skillgantry')
    expect(JSON.parse(await readFile(join(path, BUNDLED_MARKER), 'utf8'))).toEqual({
      managedBy: 'skillgantry',
      version: VERSION,
    })
    expect(h.err).toEqual([])
  })

  it('reports replaced on the second install', async () => {
    const h = await makeHeadless()
    const dir = await scratch()
    expect(await h.run(['skill', 'install', '--dir', dir])).toBe(0)

    h.out.length = 0
    expect(await h.run(['skill', 'install', '--dir', dir, '--json'])).toBe(0)

    expect(h.json()).toEqual({
      installed: [{ path: join(dir, 'skillgantry'), version: VERSION, replaced: true }],
    })
    expect(await readdir(dir)).toEqual(['skillgantry'])
  })

  it('prints one line naming the path without --json', async () => {
    const h = await makeHeadless()
    const dir = await scratch()

    expect(await h.run(['skill', 'install', '--dir', dir])).toBe(0)

    expect(h.out).toHaveLength(1)
    expect(h.out[0]).toContain(join(dir, 'skillgantry'))
    expect(h.out[0]).toContain(VERSION)
  })

  // The default destination is the one place a test could reach the real
  // `~/.claude`, which is what `CliDeps.userHome` is for.
  it('defaults to <userHome>/.claude/skills and creates that directory when absent', async () => {
    const h = await makeHeadless()
    const userHome = await scratch()

    expect(await h.run(['skill', 'install', '--json'], { userHome })).toBe(0)

    const path = join(userHome, '.claude', 'skills', 'skillgantry')
    expect(h.json()).toEqual({ installed: [{ path, version: VERSION, replaced: false }] })
    expect((await stat(join(path, 'SKILL.md'))).isFile()).toBe(true)
  })

  it('treats a --dir that does not exist as an error and creates nothing', async () => {
    const h = await makeHeadless()
    const parent = await scratch()
    const dir = join(parent, 'missing')

    expect(await h.run(['skill', 'install', '--dir', dir])).toBe(2)

    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toMatch(/^error: no such directory: /)
    expect(h.err[0]).toContain(dir)
    expect(h.out).toEqual([])
    expect(await readdir(parent)).toEqual([])
  })

  it('adds the error document under --json', async () => {
    const h = await makeHeadless()
    const dir = join(await scratch(), 'missing')

    expect(await h.run(['skill', 'install', '--dir', dir, '--json'])).toBe(2)

    expect(h.out).toHaveLength(1)
    expect(JSON.parse(h.out[0] as string)).toEqual({
      error: { message: `no such directory: ${dir}` },
    })
  })

  it('refuses a directory it did not write with 2, by name, and writes nothing', async () => {
    const h = await makeHeadless()
    const dir = await scratch()
    const path = join(dir, 'skillgantry')
    await mkdir(path)
    await writeFile(join(path, 'SKILL.md'), "someone else's\n")

    expect(await h.run(['skill', 'install', '--dir', dir])).toBe(2)

    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toMatch(/^error: /)
    expect(h.err[0]).toContain(path)
    expect(h.out).toEqual([])
    expect(await readdir(dir)).toEqual(['skillgantry'])
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe("someone else's\n")
  })
})

describe('skillgantry skill path', () => {
  it('prints the absolute path of a directory holding SKILL.md', async () => {
    const h = await makeHeadless()

    expect(await h.run(['skill', 'path'])).toBe(0)

    expect(h.out).toHaveLength(1)
    const path = h.out[0] as string
    expect(isAbsolute(path)).toBe(true)
    expect((await stat(join(path, 'SKILL.md'))).isFile()).toBe(true)
    expect(h.err).toEqual([])
  })

  it('writes no marker into the bundled directory', async () => {
    const h = await makeHeadless()
    await h.run(['skill', 'install', '--dir', await scratch()])
    await h.run(['skill', 'path'])
    expect(await readdir(h.out.at(-1) as string)).not.toContain(BUNDLED_MARKER)
  })
})
