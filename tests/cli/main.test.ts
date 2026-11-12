import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { VERSION } from '../../src/core/version.js'
import { saveToolLock } from '../../src/core/config/config.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { makeHeadless } from '../helpers/headless.js'
import { SKILL_MD_FULL } from '../helpers/tmp-repo.js'

const savedDebug = process.env['SG_DEBUG']
afterEach(() => {
  if (savedDebug === undefined) delete process.env['SG_DEBUG']
  else process.env['SG_DEBUG'] = savedDebug
})

const ambiguous = () =>
  makeHeadless({
    repos: [{ 'dup/SKILL.md': SKILL_MD_FULL('dup') }, { 'dup/SKILL.md': SKILL_MD_FULL('dup') }],
  })

describe('main() — one error contract', () => {
  it('turns an unknown skill into one error line and exit 2, with no stack', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status', 'nope'])).toBe(2)
    expect(h.err).toEqual(['error: no skill matching "nope"'])
    expect(h.out).toEqual([])
  })

  it('turns an ambiguous skill into one line naming the candidates and the full-id form', async () => {
    const h = await ambiguous()
    expect(await h.run(['status', 'dup'])).toBe(2)

    expect(h.err).toHaveLength(1)
    const line = h.err[0] as string
    expect(line).toMatch(/^error: ambiguous skill "dup": /)
    for (const repo of h.repos) expect(line).toContain(`${repo.split('/').at(-1)}/dup`)
    expect(line).toMatch(/use the full <repoId>\/<name> id$/)
    expect(line).not.toMatch(/\n|\bat .*\(/)
  })

  it('turns an unknown option into exit 2 and prints commander’s one line exactly once', async () => {
    const h = await makeHeadless()
    expect(await h.run(['list', '--bogus'])).toBe(2)
    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toContain("unknown option '--bogus'")
    expect(h.out).toEqual([])
  })

  it('turns a missing argument into exit 2 and one line', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status'])).toBe(2)
    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toContain("missing required argument 'skill'")
  })

  it('turns an unknown command into exit 2 and one line', async () => {
    const h = await makeHeadless()
    expect(await h.run(['frobnicate'])).toBe(2)
    expect(h.err).toHaveLength(1)
  })

  it('turns an unknown stage into exit 2', async () => {
    const h = await makeHeadless()
    expect(await h.run(['run', 'sk', '--stage', 'nope'])).toBe(2)
    expect(h.err).toEqual(['error: unknown stage: nope'])
  })

  it('adds one parseable document to stdout under --json, for a thrown error', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status', 'nope', '--json'])).toBe(2)
    expect(h.err).toEqual(['error: no skill matching "nope"'])
    expect(h.out).toHaveLength(1)
    expect(JSON.parse(h.out[0] as string)).toEqual({ error: { message: 'no skill matching "nope"' } })
  })

  it('adds the same document for a parse error commander already printed', async () => {
    const h = await makeHeadless()
    expect(await h.run(['list', '--bogus', '--json'])).toBe(2)
    expect(h.err).toHaveLength(1)
    expect(h.out).toHaveLength(1)
    const doc = JSON.parse(h.out[0] as string) as { error: { message: string } }
    expect(doc.error.message).toContain("unknown option '--bogus'")
    expect(doc.error.message).not.toMatch(/^error:/)
  })

  it('adds the document for a missing argument too', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status', '--json'])).toBe(2)
    expect(h.out).toHaveLength(1)
    expect(JSON.parse(h.out[0] as string)).toHaveProperty('error.message')
  })

  it('resolves --help to 0 and prints it on the output stream', async () => {
    const h = await makeHeadless()
    expect(await h.run(['--help'])).toBe(0)
    expect(h.out.join('\n')).toContain('Usage: skillgantry')
    expect(h.err).toEqual([])
  })

  it('resolves a subcommand’s --help to 0', async () => {
    const h = await makeHeadless()
    expect(await h.run(['status', '--help'])).toBe(0)
    expect(h.out.join('\n')).toContain('status')
    expect(h.err).toEqual([])
  })

  it('resolves --version to 0 and prints the version', async () => {
    const h = await makeHeadless()
    expect(await h.run(['--version'])).toBe(0)
    expect(h.out).toEqual([VERSION])
    expect(h.err).toEqual([])
  })

  it('reaches release’s own --version option rather than the root’s', async () => {
    const h = await makeHeadless()
    // No tool is locked, so the release itself fails — a 1, not a 0 from the
    // root answering `--version` and not a 2 from a parse error.
    expect(await h.run(['release', 'sk', '--version', 'minor', '--yes'])).toBe(1)
  })

  it('adds the stack under SG_DEBUG, and only then', async () => {
    const h = await makeHeadless()
    process.env['SG_DEBUG'] = '1'
    expect(await h.run(['status', 'nope'])).toBe(2)
    expect(h.err).toHaveLength(2)
    expect(h.err[0]).toBe('error: no skill matching "nope"')
    expect(h.err[1]).toMatch(/Error: no skill matching "nope"\n\s+at /)
  })

  it('keeps 1 for a run whose gate fails, with nothing on the error stream', async () => {
    const h = await makeHeadless()
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'skillspector', version: '2.5.1' } },
          results: [
            {
              ruleId: 'LP3',
              message: { text: 'no declared permissions' },
              level: 'warning',
              locations: [{ physicalLocation: { artifactLocation: { uri: 'SKILL.md' } } }],
            },
          ],
        },
      ],
    })
    const bin = await makeFakeTool('skillspector', `printf '%s' '${sarif}' > "$7"`)
    await saveToolLock(h.home, {
      version: 1,
      tools: {
        skillspector: {
          installKind: 'uv-tool',
          requestedPin: 'v2.5.1',
          resolvedVersion: '2.5.1',
          bin,
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    })

    expect(await h.run(['run', 'sk', '--stage', 'security'])).toBe(1)
    expect(h.err).toEqual([])
    expect(h.out.join('\n')).toMatch(/security\s+failed/)
  })

  it('resolves 0 for a command that succeeds', async () => {
    const h = await makeHeadless()
    expect(await h.run(['list'])).toBe(0)
  })

  it('never throws, even when the config it reads is corrupt', async () => {
    const h = await makeHeadless()
    await mkdir(h.home, { recursive: true })
    await writeFile(join(h.home, 'config.json'), '{ not json')
    await expect(h.run(['list'])).resolves.toBe(2)
    expect(h.err).toHaveLength(1)
    expect(h.err[0]).toMatch(/^error: /)
  })

  it('keeps an error to one line when its message spans several', async () => {
    const h = await makeHeadless()
    await writeFile(join(h.home, 'config.json'), '{"version": 1, "repos": "nope"}')
    expect(await h.run(['list'])).toBe(2)
    expect(h.err).toHaveLength(1)
    expect(h.err[0]).not.toContain('\n')
  })

  it('does not call process.exit, whatever commander is asked', async () => {
    const h = await makeHeadless()
    const original = process.exit
    let called = false
    process.exit = (() => {
      called = true
      throw new Error('process.exit called')
    }) as typeof process.exit
    try {
      await h.run(['list', '--bogus'])
      await h.run(['--help'])
      await h.run(['--version'])
      await h.run(['release', 'sk'])
    } finally {
      process.exit = original
    }
    expect(called).toBe(false)
  })
})

describe('main() — what commander calls help', () => {
  // A parent command given no subcommand is answered with its usage, under the
  // same `commander.help` code a requested help screen carries. The code cannot
  // say which it was; the exit code can: 0 for asked, 1 for could not carry out.
  it('resolves a parent command given no subcommand to 2, with its usage on the error stream', async () => {
    const h = await makeHeadless()
    expect(await h.run(['repo'])).toBe(2)
    expect(h.err.join('\n')).toContain('Usage: skillgantry repo')
    expect(h.out).toEqual([])
  })

  it.each([[['--help']], [['repo', '--help']], [['repo', 'add', '--help']], [['--version']]])(
    'still resolves %j to 0',
    async (args) => {
      const h = await makeHeadless()
      expect(await h.run(args)).toBe(0)
      expect(h.err).toEqual([])
    },
  )
})
