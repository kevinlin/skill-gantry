import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { loadConfig, registerRepo, saveConfig, saveToolLock } from '../../src/core/config/config.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SARIF = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results }],
  })

const FINDING = {
  ruleId: 'LP3',
  message: { text: 'no declared permissions' },
  level: 'warning',
  locations: [{ physicalLocation: { artifactLocation: { uri: 'SKILL.md' } } }],
}

async function harness(sarifBody: string) {
  const home = await mkdtemp(join(tmpdir(), 'sg-cli-home-'))
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed') } })
  await registerRepo(home, repoPath)
  const bin = await makeFakeTool('skillspector', `printf '%s' '${sarifBody}' > "$7"`)
  await saveToolLock(home, {
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

  const out: string[] = []
  const program = buildProgram({
    home,
    dbPath: ':memory:',
    write: (line) => out.push(line),
  })
  // The repo id is the registered directory's basename, so the fully qualified
  // skill id is only knowable from the fixture, never hard-coded.
  return { program, out, home, repoPath, skillId: `${basename(repoPath)}/declawed` }
}

const run = async (program: Awaited<ReturnType<typeof harness>>['program'], args: string[]) =>
  program.exitOverride().parseAsync(['node', 'skillgantry', ...args])

describe('skillgantry run', () => {
  it('exits zero when the stage passes', async () => {
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    expect(h.program.exitCode ?? 0).toBe(0)
  })

  it('reports a non-zero exit code when the stage fails', async () => {
    const h = await harness(SARIF([FINDING]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    expect(h.program.exitCode).toBe(1)
  })

  it('emits newline-delimited json events under --json', async () => {
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'security', '--json'])
    const types = h.out.map((line) => JSON.parse(line).type)
    expect(types[0]).toBe('run:start')
    expect(types.at(-1)).toBe('run:done')
  })

  it('prints a human summary without --json', async () => {
    const h = await harness(SARIF([FINDING]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    expect(h.out.join('\n')).toMatch(/security\s+failed/)
  })

  it('resolves a bare skill name and a fully qualified id', async () => {
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'security'])
    await run(h.program, ['run', h.skillId, '--stage', 'security'])
    expect(h.program.exitCode ?? 0).toBe(0)
  })

  it('fails clearly on an unknown skill', async () => {
    const h = await harness(SARIF([]))
    await expect(run(h.program, ['run', 'nope', '--stage', 'security'])).rejects.toThrow(
      /no skill matching/,
    )
  })

  it('fails clearly on an unknown stage', async () => {
    const h = await harness(SARIF([]))
    await expect(run(h.program, ['run', 'declawed', '--stage', 'nope'])).rejects.toThrow(
      /unknown stage/,
    )
  })

  it('skips a mutating stage without --yes', async () => {
    const h = await harness(SARIF([]))
    // Optimise ships no adapter yet, so a tool has to be selected for the
    // engine to have anything to report skipped — an unauthorised mutating
    // stage never resolves its selection against the registry (R12.4), so
    // this id need not be a real one.
    const config = await loadConfig(h.home)
    await saveConfig(h.home, {
      ...config,
      stageTools: { ...config.stageTools, optimise: ['fake-optimiser'] },
    })
    await run(h.program, ['run', 'declawed', '--stage', 'optimise', '--json'])
    const events = h.out.map((line) => JSON.parse(line))
    const stageDone = events.find((e) => e.type === 'stage:done')
    expect(stageDone?.outcome).toBe('skipped')
    expect(stageDone?.result.toolRuns[0]?.errorKind).toBe('no-authorisation')
  })
})
