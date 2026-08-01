import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import type { CredentialRequirement } from '../../src/core/adapters/types.js'
import type { StageContext } from '../../src/core/stages/types.js'
import type { SkillRef } from '../../src/core/types.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SARIF_EMPTY = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results: [] }],
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
