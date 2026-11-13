import { describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter } from '../../src/core/discovery/frontmatter.js'
import { VERSION } from '../../src/core/version.js'
import {
  AGENT_SKILL_NAME,
  BUNDLED_MARKER,
  bundledSkillDir,
  installAgentSkill,
  locateBundledSkill,
} from '../../src/core/tools/agent-skill.js'
import { makeRepo } from '../helpers/tmp-repo.js'

const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-agent-skill-'))

const marker = (version: string): string =>
  `${JSON.stringify({ managedBy: 'skillgantry', version })}\n`

/** The package's own tree stands in for nothing here: every case builds its source. */
const sourceWith = (files: Record<string, string>): Promise<string> => makeRepo({ files })

const names = async (dir: string): Promise<string[]> => (await readdir(dir)).sort()

describe('the bundled skill', () => {
  it('is a directory holding SKILL.md and no marker', async () => {
    const dir = await locateBundledSkill()
    expect(dir).toBe(bundledSkillDir())
    expect(await names(dir)).toContain('SKILL.md')
    expect(await names(dir)).not.toContain(BUNDLED_MARKER)
  })

  // §5.5: two version numbers for one tarball is a drift with no reader who
  // benefits. release-version.sh bumps the line; this is what notices when it
  // does not.
  it('carries the package version in its own metadata', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const text = await readFile(join(bundledSkillDir(), 'SKILL.md'), 'utf8')
    const frontmatter = parseFrontmatter(text)
    expect(frontmatter.readable).toBe(true)
    expect(frontmatter.name).toBe(AGENT_SKILL_NAME)
    expect(frontmatter.version).toBe(pkg.version)
    expect(frontmatter.version).toBe(VERSION)
  })
})

describe('installAgentSkill', () => {
  it('copies the source in beside a marker naming the version', async () => {
    const skillsDir = await scratch()
    const source = await sourceWith({ 'SKILL.md': 'one\n', 'references/a.md': 'ref\n' })

    const result = await installAgentSkill({ skillsDir, source, version: '1.0.0' })

    const path = join(skillsDir, 'skillgantry')
    expect(result).toEqual({ path, version: '1.0.0', replaced: false })
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe('one\n')
    expect(await readFile(join(path, 'references', 'a.md'), 'utf8')).toBe('ref\n')
    expect(JSON.parse(await readFile(join(path, BUNDLED_MARKER), 'utf8'))).toEqual({
      managedBy: 'skillgantry',
      version: '1.0.0',
    })
    // Nothing of the swap is left beside it.
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  it('defaults to the running version and the bundled source', async () => {
    const skillsDir = await scratch()
    const result = await installAgentSkill({ skillsDir })
    expect(result.version).toBe(VERSION)
    expect(await readFile(join(result.path, 'SKILL.md'), 'utf8')).toBe(
      await readFile(join(bundledSkillDir(), 'SKILL.md'), 'utf8'),
    )
  })

  it('replaces a copy it wrote, reports it, and leaves only the new tree', async () => {
    const skillsDir = await scratch()
    await installAgentSkill({
      skillsDir,
      source: await sourceWith({ 'SKILL.md': 'one\n', 'gone.md': 'removed upstream\n' }),
      version: '1.0.0',
    })

    const result = await installAgentSkill({
      skillsDir,
      source: await sourceWith({ 'SKILL.md': 'two\n' }),
      version: '1.1.0',
    })

    const path = join(skillsDir, 'skillgantry')
    expect(result).toEqual({ path, version: '1.1.0', replaced: true })
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe('two\n')
    expect(await names(path)).toEqual([BUNDLED_MARKER, 'SKILL.md'])
    expect(JSON.parse(await readFile(join(path, BUNDLED_MARKER), 'utf8'))).toMatchObject({
      version: '1.1.0',
    })
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  it('refuses a directory with no marker, by name, and writes nothing', async () => {
    const skillsDir = await scratch()
    const path = join(skillsDir, 'skillgantry')
    await mkdir(path)
    await writeFile(join(path, 'SKILL.md'), "someone else's\n")

    await expect(
      installAgentSkill({ skillsDir, source: await sourceWith({ 'SKILL.md': 'x\n' }), version: '1.0.0' }),
    ).rejects.toThrow(path)

    expect(await names(path)).toEqual(['SKILL.md'])
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe("someone else's\n")
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  // Presence alone is not ownership: a file of that name proves only that
  // something wrote one.
  it.each([
    ['another tool', JSON.stringify({ managedBy: 'someone-else', version: '1.0.0' })],
    ['no version', JSON.stringify({ managedBy: 'skillgantry' })],
    ['a non-string version', JSON.stringify({ managedBy: 'skillgantry', version: 1 })],
    ['an extra field', JSON.stringify({ managedBy: 'skillgantry', version: '1.0.0', extra: true })],
    ['not an object', JSON.stringify(['skillgantry'])],
    ['not JSON', 'managed by skillgantry'],
    ['nothing', ''],
  ])('refuses a marker holding %s', async (_label, contents) => {
    const skillsDir = await scratch()
    const path = join(skillsDir, 'skillgantry')
    await mkdir(path)
    await writeFile(join(path, BUNDLED_MARKER), contents)
    await writeFile(join(path, 'SKILL.md'), 'kept\n')

    await expect(
      installAgentSkill({ skillsDir, source: await sourceWith({ 'SKILL.md': 'x\n' }), version: '1.0.0' }),
    ).rejects.toThrow(path)

    expect(await readFile(join(path, BUNDLED_MARKER), 'utf8')).toBe(contents)
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe('kept\n')
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  it('refuses a marker that is itself a link, without reading through it', async () => {
    const skillsDir = await scratch()
    const elsewhere = join(await scratch(), 'marker.json')
    await writeFile(elsewhere, marker('1.0.0'))
    const path = join(skillsDir, 'skillgantry')
    await mkdir(path)
    await symlink(elsewhere, join(path, BUNDLED_MARKER))

    await expect(
      installAgentSkill({ skillsDir, source: await sourceWith({ 'SKILL.md': 'x\n' }), version: '1.1.0' }),
    ).rejects.toThrow(path)
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  it('refuses a file at the destination, by name', async () => {
    const skillsDir = await scratch()
    const path = join(skillsDir, 'skillgantry')
    await writeFile(path, 'a file\n')

    await expect(
      installAgentSkill({ skillsDir, source: await sourceWith({ 'SKILL.md': 'x\n' }), version: '1.0.0' }),
    ).rejects.toThrow(path)
    expect(await readFile(path, 'utf8')).toBe('a file\n')
  })

  // The target carries a valid marker on purpose: a link refused only because
  // what it points at looked foreign would be followed the day it did not.
  it('refuses a symlink at the destination without following it', async () => {
    const skillsDir = await scratch()
    const target = await scratch()
    await writeFile(join(target, 'SKILL.md'), 'the target\n')
    await writeFile(join(target, BUNDLED_MARKER), marker('1.0.0'))
    const path = join(skillsDir, 'skillgantry')
    await symlink(target, path)

    await expect(
      installAgentSkill({ skillsDir, source: await sourceWith({ 'SKILL.md': 'x\n' }), version: '1.1.0' }),
    ).rejects.toThrow(path)

    expect((await lstat(path)).isSymbolicLink()).toBe(true)
    expect(await names(target)).toEqual([BUNDLED_MARKER, 'SKILL.md'])
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('the target\n')
    expect(await readFile(join(target, BUNDLED_MARKER), 'utf8')).toBe(marker('1.0.0'))
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  it('refuses a dangling symlink at the destination', async () => {
    const skillsDir = await scratch()
    const path = join(skillsDir, 'skillgantry')
    await symlink(join(skillsDir, 'nowhere'), path)

    await expect(
      installAgentSkill({ skillsDir, source: await sourceWith({ 'SKILL.md': 'x\n' }), version: '1.0.0' }),
    ).rejects.toThrow(path)
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
  })

  it('moves the previous copy back when the second rename fails', async () => {
    const skillsDir = await scratch()
    const path = join(skillsDir, 'skillgantry')
    await installAgentSkill({
      skillsDir,
      source: await sourceWith({ 'SKILL.md': 'one\n' }),
      version: '1.0.0',
    })

    await expect(
      installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'two\n' }),
        version: '1.1.0',
        // Only the move of the new tree fails: the move of the old one out of
        // the way has to land for there to be a previous copy to put back, and
        // the put-back is itself a move into the destination.
        rename: async (from, to) => {
          if (from === `${path}.sg-new`) throw new Error('injected: cannot rename into place')
          await rename(from, to)
        },
      }),
    ).rejects.toThrow(path)

    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe('one\n')
    expect(JSON.parse(await readFile(join(path, BUNDLED_MARKER), 'utf8'))).toMatchObject({
      version: '1.0.0',
    })
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  it('leaves no destination and no sibling when a first install fails on the second rename', async () => {
    const skillsDir = await scratch()
    const path = join(skillsDir, 'skillgantry')

    await expect(
      installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'one\n' }),
        version: '1.0.0',
        rename: async (from) => {
          if (from === `${path}.sg-new`) throw new Error('injected: cannot rename into place')
        },
      }),
    ).rejects.toThrow(path)

    expect(await names(skillsDir)).toEqual([])
  })

  it('keeps the destination as it was when the build fails', async () => {
    const skillsDir = await scratch()
    const path = join(skillsDir, 'skillgantry')
    await installAgentSkill({
      skillsDir,
      source: await sourceWith({ 'SKILL.md': 'one\n' }),
      version: '1.0.0',
    })

    await expect(
      installAgentSkill({ skillsDir, source: join(skillsDir, 'no-such-source'), version: '1.1.0' }),
    ).rejects.toThrow()

    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe('one\n')
    expect(await names(skillsDir)).toEqual(['skillgantry'])
  })

  describe.each([['sg-new'], ['sg-old']])('a leftover %s sibling', (suffix) => {
    const leftover = (skillsDir: string): string => join(skillsDir, `skillgantry.${suffix}`)

    it('is removed when it carries a valid marker, and the install completes', async () => {
      const skillsDir = await scratch()
      await mkdir(leftover(skillsDir))
      await writeFile(join(leftover(skillsDir), BUNDLED_MARKER), marker('0.9.0'))
      await writeFile(join(leftover(skillsDir), 'half.md'), 'an interrupted copy\n')

      const result = await installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'one\n' }),
        version: '1.0.0',
      })

      expect(result.replaced).toBe(false)
      expect(await names(skillsDir)).toEqual(['skillgantry'])
      expect(await readFile(join(result.path, 'SKILL.md'), 'utf8')).toBe('one\n')
    })

    it('is removed beside a destination that is replaced', async () => {
      const skillsDir = await scratch()
      await installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'one\n' }),
        version: '1.0.0',
      })
      await mkdir(leftover(skillsDir))
      await writeFile(join(leftover(skillsDir), BUNDLED_MARKER), marker('0.9.0'))

      const result = await installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'two\n' }),
        version: '1.1.0',
      })

      expect(result.replaced).toBe(true)
      expect(await names(skillsDir)).toEqual(['skillgantry'])
    })

    it('is refused by name when it carries no marker, and nothing is written', async () => {
      const skillsDir = await scratch()
      await mkdir(leftover(skillsDir))
      await writeFile(join(leftover(skillsDir), 'mine.md'), "someone's files\n")

      await expect(
        installAgentSkill({
          skillsDir,
          source: await sourceWith({ 'SKILL.md': 'one\n' }),
          version: '1.0.0',
        }),
      ).rejects.toThrow(leftover(skillsDir))

      expect(await names(skillsDir)).toEqual([`skillgantry.${suffix}`])
      expect(await names(leftover(skillsDir))).toEqual(['mine.md'])
    })

    it('is refused when it is a symlink, and the target is untouched', async () => {
      const skillsDir = await scratch()
      const target = await scratch()
      await writeFile(join(target, BUNDLED_MARKER), marker('0.9.0'))
      await symlink(target, leftover(skillsDir))

      await expect(
        installAgentSkill({
          skillsDir,
          source: await sourceWith({ 'SKILL.md': 'one\n' }),
          version: '1.0.0',
        }),
      ).rejects.toThrow(leftover(skillsDir))

      expect(await names(target)).toEqual([BUNDLED_MARKER])
    })
  })

  it('removes nothing when one sibling is marked and the other is not', async () => {
    const skillsDir = await scratch()
    const fresh = join(skillsDir, 'skillgantry.sg-new')
    const old = join(skillsDir, 'skillgantry.sg-old')
    await mkdir(fresh)
    await writeFile(join(fresh, BUNDLED_MARKER), marker('0.9.0'))
    await mkdir(old)
    await writeFile(join(old, 'mine.md'), "someone's files\n")

    await expect(
      installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'one\n' }),
        version: '1.0.0',
      }),
    ).rejects.toThrow(old)

    // A refusal is decided before the first removal, or "writes nothing" is a
    // claim about the order the siblings happened to be visited in.
    expect(await names(skillsDir)).toEqual(['skillgantry.sg-new', 'skillgantry.sg-old'])
    expect(await names(fresh)).toEqual([BUNDLED_MARKER])
  })

  it('errors on a skills directory that does not exist, creating nothing', async () => {
    const parent = await scratch()
    const skillsDir = join(parent, 'missing')

    await expect(
      installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'one\n' }),
        version: '1.0.0',
      }),
    ).rejects.toThrow(skillsDir)

    expect(await names(parent)).toEqual([])
  })

  it('errors on a skills directory that is a file', async () => {
    const parent = await scratch()
    const skillsDir = join(parent, 'file')
    await writeFile(skillsDir, 'x')

    await expect(
      installAgentSkill({
        skillsDir,
        source: await sourceWith({ 'SKILL.md': 'one\n' }),
        version: '1.0.0',
      }),
    ).rejects.toThrow(skillsDir)
  })
})
