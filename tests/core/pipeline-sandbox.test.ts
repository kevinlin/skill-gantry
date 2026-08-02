import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runPipeline } from '../../src/core/pipeline/run.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import { scanSandboxRecords } from '../../src/core/isolation/record.js'
import type { RunEvent } from '../../src/core/pipeline/events.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'
import { makeFakeMutatingTool } from '../helpers/fake-mutating-tool.js'

const OPTIMISED = SKILL_MD_FULL('sk', '1.0.0', 'rewritten by the optimiser')

/** A registry the optimise stage can be planned against; none ships. */
const fakeAdapter = (bin: string) => ({
  manifest: {
    id: 'fake-optimiser',
    stage: 'optimise' as const,
    policy: 'pick-one' as const,
    mutating: true,
    detects: [],
    credentials: { kind: 'none' as const },
    analysisMode: 'static',
    install: { kind: 'npm-prefix' as const, spec: 'x', pin: '1.0.0', binName: 'x' },
    invoke: { argv: ['{skillDir}', '{toolDir}'], cwd: 'repoRoot' as const },
    versionArgv: ['--version'],
    artefacts: ['findings.sarif'],
    timeoutMs: 30_000,
  },
  parse: () => ({ outcome: 'passed' as const, findings: [], metrics: {}, summary: 'rewrote' }),
  bin,
})

async function harness() {
  const repo = await makeGitRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const skill: SkillRef = {
    id: 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir: join(repo, 'sk'),
    relPath: 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: true },
    rootSkill: false,
    workspacePath: workspacePath(repo, 'sk', false),
  }
  const tool = await makeFakeMutatingTool(OPTIMISED)
  const adapter = fakeAdapter(tool.bin)
  const ledger = openLedger(':memory:')

  const start = (over: Parameters<typeof runPipeline>[0] extends infer T ? Partial<T> : never) =>
    runPipeline({
      skill,
      stages: ['optimise'],
      trigger: 'test',
      stageTools: { optimise: ['fake-optimiser'] },
      lock: {
        version: 1,
        tools: {
          'fake-optimiser': {
            installKind: 'npm-prefix',
            requestedPin: '1.0.0',
            resolvedVersion: '1.0.0',
            bin: tool.bin,
            integrity: 'n/a',
            installedAt: 'now',
            verifiedAt: 'now',
          },
        },
      },
      ledger,
      env: process.env,
      secrets: [],
      provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
      artefactSizeCapBytes: 1_000_000,
      timeoutOverridesMs: {},
      executorFactory: () =>
        new AdapterStageExecutor('optimise', { lookup: (id) => (id === 'fake-optimiser' ? adapter : undefined) }),
      ...over,
    })

  return { repo, skill, start }
}

describe('a mutating stage through the pipeline', () => {
  it('points the tool inside the sandbox and leaves the live tree untouched until apply', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    const seen: RunEvent[] = []
    const draining = (async () => {
      for await (const event of handle.events) seen.push(event)
    })()

    // The prompt arrives before anything is written — R5.2's ordering.
    while (!seen.some((e) => e.type === 'mutation:pending')) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))

    const pending = seen.find((e) => e.type === 'mutation:pending')
    handle.resolveMutation((pending as Extract<RunEvent, { type: 'mutation:pending' }>).requestId, 'discard')
    await draining
    await handle.done
  })

  it('emits mutation:pending carrying the diff, then applies on approval', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') {
          expect(event.diff).toContain('rewritten by the optimiser')
          expect(event.scope).toEqual(['sk/SKILL.md'])
          handle.resolveMutation(event.requestId, 'apply')
        }
      }
    })()
    const summary = await handle.done
    expect(summary.outcome).toBe('passed')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(OPTIMISED)
  })

  it('leaves the tree unchanged and reports skipped on discard', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'discard')
      }
    })()
    const summary = await handle.done
    expect(summary.stages[0]?.outcome).toBe('skipped')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
  })

  it('skips with no-authorisation when the run was not authorised', async () => {
    const { repo, start } = await harness()
    const summary = await start({ authorised: false }).done
    expect(summary.stages[0]?.outcome).toBe('skipped')
    expect(summary.stages[0]?.toolRuns[0]?.errorKind).toBe('no-authorisation')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
  })

  it('reports mutation-aborted and finalises when a target drifts before apply', async () => {
    const { repo, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') {
          // The user edits while the diff sits on screen — R10.11's window.
          await writeFile(join(repo, 'sk/SKILL.md'), 'hand-edited\n')
          handle.resolveMutation(event.requestId, 'apply')
        }
      }
    })()
    const summary = await handle.done
    expect(summary.stages[0]?.outcome).toBe('errored')
    expect(summary.stages[0]?.toolRuns[0]?.errorKind).toBe('mutation-aborted')
    // R5.13: the run still finalises, so the partial evidence survives.
    expect(summary.runId).toBeTruthy()
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('hand-edited\n')
  })

  it('settles the sandbox record on every path, so nothing is left reported as active', async () => {
    const { skill, start } = await harness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'apply')
      }
    })()
    await handle.done
    expect(await scanSandboxRecords(skill.workspacePath)).toEqual([])
  })
})
