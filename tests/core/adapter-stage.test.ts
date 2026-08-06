import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterStageExecutor, classifyToolRun } from '../../src/core/stages/adapter-stage.js'
import { manifest as skillspectorManifest } from '../../src/core/adapters/skillspector.js'
import type { Adapter, CredentialRequirement, ToolResult } from '../../src/core/adapters/types.js'
import type { StageContext } from '../../src/core/stages/types.js'
import type { RawFinding, Severity, SkillRef } from '../../src/core/types.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SARIF_EMPTY = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results: [] }],
})

const SARIF_ONE = (ruleId: string, level = 'warning'): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'fixture', version: '1.0.0' } },
        results: [
          {
            ruleId,
            level,
            message: { text: ruleId },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'SKILL.md' } } }],
          },
        ],
      },
    ],
  })

/**
 * Real directories, not notional ones: the executor spawns the tool with
 * `cwd` set to the repo root, and a child cannot start in a cwd that does
 * not exist — every run would classify as `spawn` regardless of the case.
 */
async function makeSkill(): Promise<SkillRef> {
  const repoPath = await mkdtemp(join(tmpdir(), 'sg-repo-'))
  const dir = join(repoPath, 'declawed')
  await mkdir(dir, { recursive: true })
  return {
    id: 'fx/declawed',
    relPath: 'declawed',
    dir,
    repo: { id: 'fx', path: repoPath, name: 'fx', isGit: false },
  } as unknown as SkillRef
}

async function context(over: Partial<StageContext> = {}): Promise<StageContext> {
  return {
    skill: await makeSkill(),
    stage: 'security',
    stageDir: await mkdtemp(join(tmpdir(), 'sg-stage-')),
    selectedToolIds: ['skillspector'],
    lock: { version: 1, tools: {} },
    env: {},
    secrets: [],
    artefactSizeCapBytes: 1024 * 1024,
    timeoutOverridesMs: {},
    onOutput: () => undefined,
    ...over,
  }
}

const NEEDS_KEY: CredentialRequirement = {
  kind: 'one-of',
  alternatives: [
    { provider: 'NVIDIA', required: ['NVIDIA_INFERENCE_KEY'] },
    { provider: 'OpenAI', required: ['OPENAI_API_KEY'] },
  ],
}

async function lockWith(script: string) {
  const bin = await makeFakeTool('skillspector', script)
  return {
    version: 1 as const,
    tools: {
      skillspector: {
        installKind: 'uv-tool' as const,
        requestedPin: 'v2.5.1',
        resolvedVersion: '2.5.1',
        bin,
        integrity: 'n/a',
        installedAt: '2026-08-01T00:00:00Z',
        verifiedAt: '2026-08-01T00:00:00Z',
      },
    },
  }
}

describe('AdapterStageExecutor.plan', () => {
  it('rejects an empty selection before anything runs', async () => {
    const exec = new AdapterStageExecutor('security')
    await expect(exec.plan(await context({ selectedToolIds: [] }))).rejects.toThrow(/no tools/)
  })

  it('rejects a tool that does not belong to the stage', async () => {
    const exec = new AdapterStageExecutor('validate')
    await expect(exec.plan(await context({ stage: 'validate' }))).rejects.toThrow(/not a validate/)
  })

  it('declares an empty mutation scope for a read-only stage', async () => {
    const exec = new AdapterStageExecutor('security')
    expect((await exec.plan(await context())).mutationScope.paths).toEqual([])
  })
})

describe('AdapterStageExecutor.execute', () => {
  it('records a passed tool run and passes the stage', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.outcome).toBe('passed')
    expect(result.toolRuns[0]?.outcome).toBe('passed')
    expect(result.toolRuns[0]?.toolVersion).toBe('2.5.1')
  })

  it('skips a selected tool that is not installed instead of dropping it', async () => {
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock: { version: 1, tools: {} } })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns).toHaveLength(1)
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'skipped', errorKind: 'not-installed' })
    expect(result.outcome).toBe('skipped')
  })

  it('errors when the tool writes no artefact', async () => {
    const lock = await lockWith('exit 0')
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'errored', errorKind: 'missing-artefact' })
    expect(result.outcome).toBe('errored')
  })

  it('errors with timeout when the tool hangs', async () => {
    const lock = await lockWith('sleep 600')
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock, timeoutOverridesMs: { skillspector: 800 } })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'errored', errorKind: 'timeout' })
  })

  it('writes each tool into its own artefact directory', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]?.artefactDir).toBe(join(ctx.stageDir, 'skillspector'))
  })

  it('gives two real scanners writing findings.sarif their own file — R4.9', async () => {
    // Both manifests end in `--output {toolDir}/findings.sarif`, at different
    // argv positions: $7 for skillspector, $8 for skill-scanner.
    const spectorBin = await makeFakeTool(
      'skillspector',
      `printf '%s' '${SARIF_ONE('AST4')}' > "$7"; exit 1`,
    )
    const scannerBin = await makeFakeTool(
      'skill-scanner',
      `printf '%s' '${SARIF_ONE('skill-scanner/credential_leak')}' > "$8"; exit 1`,
    )
    const lockEntry = (bin: string) => ({
      installKind: 'uv-tool' as const,
      requestedPin: 'v1',
      resolvedVersion: '1.0.0',
      bin,
      integrity: 'n/a',
      installedAt: '2026-08-01T00:00:00Z',
      verifiedAt: '2026-08-01T00:00:00Z',
    })

    const exec = new AdapterStageExecutor('security')
    const ctx = await context({
      selectedToolIds: ['skillspector', 'skill-scanner'],
      lock: {
        version: 1,
        tools: { skillspector: lockEntry(spectorBin), 'skill-scanner': lockEntry(scannerBin) },
      },
      env: { SKILLSCAN_API_KEY: 'k', SKILLSCAN_MODEL: 'm' },
    })
    const result = await exec.execute(ctx, await exec.plan(ctx))

    expect(result.toolRuns.map((t) => t.artefactDir)).toEqual([
      join(ctx.stageDir, 'skillspector'),
      join(ctx.stageDir, 'skill-scanner'),
    ])
    // Same filename, two files, both parsed.
    for (const run of result.toolRuns) {
      await expect(stat(join(run.artefactDir, 'findings.sarif'))).resolves.toBeTruthy()
      expect(run.findings).toHaveLength(1)
    }
    expect(result.outcome).toBe('failed')
  })

  it('skips a credential-requiring tool and names what is missing', async () => {
    const lock = await lockWith('exit 0')
    const exec = new AdapterStageExecutor('security', {
      credentialsOverride: { skillspector: NEEDS_KEY },
    })
    const ctx = await context({ lock, env: {} })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'skipped', errorKind: 'no-credentials' })
    expect(result.toolRuns[0]?.summary).toMatch(/NVIDIA_INFERENCE_KEY.*OPENAI_API_KEY/s)
  })

  it('runs when any one credential alternative is satisfied', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const exec = new AdapterStageExecutor('security', {
      credentialsOverride: { skillspector: NEEDS_KEY },
    })
    const ctx = await context({ lock, env: { OPENAI_API_KEY: 'x' } })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]?.outcome).toBe('passed')
  })

  it('passes a non-zero exit whose report parses clean — R4.13 row 11', async () => {
    const lock = await lockWith(`printf '%s' '${SARIF_EMPTY}' > "$7"; exit 1`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'passed', exitCode: 1, errorKind: null })
  })

  it('passes findings that stay below the fail floor, keeping them — R4.13 row 12b', async () => {
    // SARIF `note` normalises to `low`, under the `medium` floor.
    const lock = await lockWith(`printf '%s' '${SARIF_ONE('AST4', 'note')}' > "$7"`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))

    const run = result.toolRuns[0]
    expect(run).toMatchObject({ outcome: 'passed', errorKind: null })
    // The finding survives, which is what keeps it filed and reconcilable.
    expect(run?.findings).toHaveLength(1)
    expect(run?.findings[0]?.severity).toBe('low')
    expect(run?.summary).toMatch(/highest low/)
    expect(result.outcome).toBe('passed')
  })

  it('still fails on one finding at the floor among sub-floor ones — R4.13 row 12', async () => {
    const mixed = JSON.stringify({
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'fixture', version: '1.0.0' } },
          results: [
            { ruleId: 'AST4', level: 'note', message: { text: 'a' } },
            { ruleId: 'P2', level: 'warning', message: { text: 'b' } },
          ],
        },
      ],
    })
    const lock = await lockWith(`printf '%s' '${mixed}' > "$7"`)
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]?.outcome).toBe('failed')
  })

  it('passes real skill-lint output whose only findings are LOW — run 019fc2e4', async () => {
    // The reported defect: skill-lint 0.2.0 exited 0 calling declawed SAFE, and
    // its two LOW `R06` "bundled script" advisories failed validate anyway.
    const fixture = join(process.cwd(), 'tests/fixtures/skill-lint/architecture-diagram.json')
    const bin = await makeFakeTool('skill-lint', `cat ${fixture}`)
    const exec = new AdapterStageExecutor('validate')
    const ctx = await context({
      stage: 'validate',
      selectedToolIds: ['skill-lint'],
      lock: {
        version: 1,
        tools: {
          'skill-lint': {
            installKind: 'npm-prefix',
            requestedPin: '0.2.0',
            resolvedVersion: '0.2.0',
            bin,
            integrity: 'n/a',
            installedAt: '2026-08-01T00:00:00Z',
            verifiedAt: '2026-08-01T00:00:00Z',
          },
        },
      },
    })
    const result = await exec.execute(ctx, await exec.plan(ctx))

    expect(result.toolRuns[0]?.outcome).toBe('passed')
    expect(result.toolRuns[0]?.findings).toHaveLength(2)
    expect(result.outcome).toBe('passed')
  })

  it('classifies an absent declared artefact before invoking the parser — R4.13 row 7', async () => {
    const lock = await lockWith('exit 0')
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({
      outcome: 'errored',
      errorKind: 'missing-artefact',
    })
  })

  it('errors when the executable does not exist — R4.13 row 13', async () => {
    const lock = {
      version: 1 as const,
      tools: {
        skillspector: {
          installKind: 'uv-tool' as const,
          requestedPin: 'v2.5.1',
          resolvedVersion: '2.5.1',
          bin: '/nonexistent/skillspector',
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    }
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock })
    const result = await exec.execute(ctx, await exec.plan(ctx))
    expect(result.toolRuns[0]).toMatchObject({ outcome: 'errored', errorKind: 'spawn' })
  })

  it('streams output through onOutput', async () => {
    const lock = await lockWith(`echo scanning; printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const onOutput = vi.fn()
    const exec = new AdapterStageExecutor('security')
    const ctx = await context({ lock, onOutput })
    await exec.execute(ctx, await exec.plan(ctx))
    expect(onOutput).toHaveBeenCalled()
  })
})

/** §8.1 rows 12, 12b and 12c, driven straight through the classifier. */
describe('classifyToolRun — suppression and the fail floor', () => {
  const finding = (severity: Severity, suppressed = false): RawFinding => ({
    ruleClass: 'unsafe-script',
    nativeRuleId: `MP-${severity}${suppressed ? '-s' : ''}`,
    severity,
    path: 'declawed/scripts/scan.py',
    message: severity,
    ...(suppressed ? { suppressed: { justification: 'accepted' } } : {}),
  })

  const adapterReturning = (result: ToolResult): Adapter =>
    ({ manifest: skillspectorManifest, parse: () => result }) as unknown as Adapter

  const run = {
    exitCode: 0,
    signalled: null,
    timedOut: false,
    cancelled: false,
    spawnFailed: false,
    spawnError: null,
    durationMs: 10,
    stdout: '',
    stderr: '',
    artefacts: new Map<string, Buffer>(),
    missingArtefacts: [],
    oversizeArtefacts: [],
  }

  const classify = async (findings: RawFinding[], outcome: 'failed' | 'passed' = 'failed') => {
    const skill = await makeSkill()
    return classifyToolRun(
      adapterReturning({ outcome, findings, metrics: {}, summary: `${findings.length} findings` }),
      skill,
      run,
    )
  }

  it('row 12c: every finding suppressed passes, and keeps all of them', async () => {
    const out = await classify([finding('critical', true), finding('high', true)])
    expect(out.outcome).toBe('passed')
    expect(out.findings).toHaveLength(2)
    expect(out.summary).toMatch(/none actionable/)
  })

  it('row 12b: a suppressed high beside a live low still passes', async () => {
    const out = await classify([finding('high', true), finding('low')])
    expect(out.outcome).toBe('passed')
    expect(out.summary).toMatch(/highest low/)
    expect(out.findings).toHaveLength(2)
  })

  it('row 12: a suppressed low does not rescue a live high', async () => {
    expect((await classify([finding('low', true), finding('high')])).outcome).toBe('failed')
  })

  it('leaves a parser that failed with no findings at all alone', async () => {
    // Without the `findings.length > 0` guard this would silently downgrade.
    expect((await classify([])).outcome).toBe('failed')
  })
})

/** R4.14. The tool records the argv it was handed, so the assertions are exact. */
describe('conditional argv — R4.14', () => {
  const RECORDING = `printf '%s' '${SARIF_EMPTY}' > "$7"; printf '%s\\n' "$@" > "$SG_ARGV_LOG"`

  async function argvOf(ctx: StageContext): Promise<string[]> {
    const exec = new AdapterStageExecutor('security')
    await exec.execute(ctx, await exec.plan(ctx))
    const log = ctx.env.SG_ARGV_LOG as string
    return (await readFile(log, 'utf8')).split('\n').filter((line) => line.length > 0)
  }

  async function ctxWithLog(): Promise<StageContext> {
    const lock = await lockWith(RECORDING)
    const dir = await mkdtemp(join(tmpdir(), 'sg-argv-'))
    return context({ lock, env: { SG_ARGV_LOG: join(dir, 'argv') } })
  }

  it('omits the group when the declared path does not exist', async () => {
    expect(await argvOf(await ctxWithLog())).not.toContain('--baseline')
  })

  it('appends it carrying the substituted path when the file exists', async () => {
    const ctx = await ctxWithLog()
    const baseline = join(ctx.skill.dir, '.skillspector-baseline.yaml')
    await writeFile(baseline, 'version: 1\n')
    const argv = await argvOf(ctx)
    expect(argv.slice(-2)).toEqual(['--baseline', baseline])
  })

  it('does not fire on a directory at that path', async () => {
    const ctx = await ctxWithLog()
    await mkdir(join(ctx.skill.dir, '.skillspector-baseline.yaml'))
    expect(await argvOf(ctx)).not.toContain('--baseline')
  })

  it('names the re-rooted skill dir, not the source, once a sandbox has moved it', async () => {
    // What `pipeline/run.ts` does before `execute`: `ctx.skill.dir` points at
    // the sandbox or the materialised candidate, never at the user's tree —
    // which is why the stat lives in execute() rather than plan().
    const ctx = await ctxWithLog()
    const source = ctx.skill.dir
    const candidate = await mkdtemp(join(tmpdir(), 'sg-candidate-'))
    await writeFile(join(source, '.skillspector-baseline.yaml'), 'version: 1\n')
    const rerooted = {
      ...ctx,
      skill: { ...ctx.skill, dir: candidate },
    } as StageContext

    expect(await argvOf(rerooted)).not.toContain('--baseline')

    await writeFile(join(candidate, '.skillspector-baseline.yaml'), 'version: 1\n')
    const argv = await argvOf(rerooted)
    expect(argv.slice(-2)).toEqual(['--baseline', join(candidate, '.skillspector-baseline.yaml')])
    expect(argv).not.toContain(join(source, '.skillspector-baseline.yaml'))
  })
})
