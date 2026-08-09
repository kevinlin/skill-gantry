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

  it('skips a mutating stage without --yes under the shipped default config', async () => {
    // Optimise ships no adapter, so the shipped default is an empty
    // selection (`optimise: []`) — the request must still reach a real
    // stage:done rather than rejecting `plan()`'s "no tools selected" check.
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'optimise', '--json'])
    const events = h.out.map((line) => JSON.parse(line))
    const stageDone = events.find((e) => e.type === 'stage:done')
    expect(stageDone?.outcome).toBe('skipped')
    expect(stageDone?.result.toolRuns).toEqual([])
    expect(events.at(-1)?.type).toBe('run:done')
  })

  it('settles an authorised empty selection as a recorded errored stage', async () => {
    // The `--yes` twin of the case above, and the terminal interface's constant:
    // authorisation takes the stage past R12.4's skip and into `plan()`'s R4.11
    // rejection. That throw used to escape the stage loop, so the run ended as
    // `run:error` with no stage.json and no ledger row — the partial evidence
    // R5.13 requires it to keep. It now settles as a stage that says why.
    const h = await harness(SARIF([]))
    await run(h.program, ['run', 'declawed', '--stage', 'optimise', '--yes', '--json'])
    const events = h.out.map((line) => JSON.parse(line))
    const stageDone = events.find((e) => e.type === 'stage:done')
    expect(stageDone?.outcome).toBe('errored')
    expect(stageDone?.result.toolRuns[0]?.errorKind).toBe('plan-failed')
    expect(events.some((e) => e.type === 'run:error')).toBe(false)
    expect(events.at(-1)?.type).toBe('run:done')
  })

  it('finalises a mixed validate,optimise run against the shipped default config', async () => {
    // validate genuinely runs and passes; optimise is skipped for want of
    // --yes. Before R12.4 moved into the engine, a throw out of plan() for
    // the empty optimise selection would have escaped the stage loop before
    // finalizeRun/recordRun ran, leaving an unfinalised run for the next
    // invocation to report as interrupted.
    const h = await harness(SARIF([]))
    const skillLintBin = await makeFakeTool(
      'skill-lint',
      `printf '%s' '{"schemaVersion":1,"skill":{"files":[]},"findings":[]}'`,
    )
    const config = await loadConfig(h.home)
    await saveConfig(h.home, {
      ...config,
      stageTools: { ...config.stageTools, validate: ['skill-lint'] },
    })
    await saveToolLock(h.home, {
      version: 1,
      tools: {
        'skill-lint': {
          installKind: 'npm-prefix',
          requestedPin: '0.2.0',
          resolvedVersion: '0.2.0',
          bin: skillLintBin,
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    })

    await run(h.program, ['run', 'declawed', '--stage', 'validate,optimise', '--json'])
    const events = h.out.map((line) => JSON.parse(line))
    const stagesDone = events.filter((e) => e.type === 'stage:done')
    expect(stagesDone.map((e) => e.stage)).toEqual(['validate', 'optimise'])
    expect(stagesDone[0]?.outcome).toBe('passed')
    expect(stagesDone[1]?.outcome).toBe('skipped')
    expect(stagesDone[1]?.result.toolRuns).toEqual([])
    // The run finalised: recordRun and finalizeRun both ran despite optimise
    // having nothing configured for it.
    expect(events.at(-1)?.type).toBe('run:done')
    expect(typeof h.program.exitCode).toBe('number')
  })
})

describe('skillgantry --version', () => {
  // R13.5's verify clause is literally `skillgantry --version` from a clean
  // prefix. Commander scans the whole argv for the root's own options before
  // ever dispatching to a subcommand unless `enablePositionalOptions` is set,
  // so `release --version <target>` was silently answered by the *root's*
  // `--version` and never reached the subcommand's own required option — a
  // regression a prior task introduced by dropping the root's `--version`
  // alias entirely instead. Both flags, and both call sites, are pinned here
  // so neither can regress silently again.
  it('prints the version on the long flag', async () => {
    const h = await harness(SARIF([]))
    await expect(run(h.program, ['--version'])).rejects.toMatchObject({ code: 'commander.version' })
  })

  it('prints the version on -V', async () => {
    const h = await harness(SARIF([]))
    await expect(run(h.program, ['-V'])).rejects.toMatchObject({ code: 'commander.version' })
  })

  it("reaches release's own --version <target> option, not the root flag", async () => {
    const h = await harness(SARIF([]))
    // Before the fix, this `--version` was answered by the root program: the
    // call rejected with `commander.version` and never ran the release
    // action at all. It has nothing locked or gated, so it still fails —
    // but by running the real action (a normal non-zero exit), not by the
    // root's version handler short-circuiting the parse.
    await run(h.program, ['release', 'declawed', '--version', 'minor', '--yes'])
    expect(h.program.exitCode).toBe(1)
  })
})
