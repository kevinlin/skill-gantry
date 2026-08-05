import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/run-command.js'
import { DEFAULT_CONFIG, registerRepo, saveConfig } from '../../src/core/config/config.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

const FINDING = {
  ruleClass: 'excessive-permission',
  nativeRuleId: 'LP3',
  severity: 'medium',
  path: 'sk/SKILL.md',
  line: 1,
  message: 'no declared permissions but code capabilities were detected: file_read',
}

const stageJson = (stage: string, findings: unknown[]) =>
  JSON.stringify({
    stage,
    outcome: findings.length > 0 ? 'failed' : 'passed',
    verdict: findings.length > 0 ? 'failed' : 'passed',
    toolRuns: [
      {
        toolId: 'skillspector',
        toolVersion: '2.5.1',
        outcome: findings.length > 0 ? 'failed' : 'passed',
        exitCode: findings.length > 0 ? 1 : 0,
        durationMs: 10,
        errorKind: null,
        artefactDir: 'unused-here',
        findings,
        metrics: {},
        summary: `${findings.length} findings`,
      },
    ],
  })

interface RunSpec {
  id: string
  /** stage name → findings on that stage. */
  stages: Record<string, unknown[]>
  /** Stages whose fix-prompt.md is written, as the pipeline would. */
  withPrompt?: string[]
}

const NUMBER: Record<string, string> = {
  validate: '01',
  evaluate: '02',
  security: '03',
  optimise: '04',
  release: '05',
}

async function harness(runs: RunSpec[]) {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  await saveConfig(home, DEFAULT_CONFIG)
  await registerRepo(home, repo)

  const ws = workspacePath(repo, 'sk', false)
  const runsRoot = join(ws, 'skillgantry', 'runs')
  await mkdir(runsRoot, { recursive: true })

  for (const spec of runs) {
    const runDir = join(runsRoot, spec.id)
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, 'run.json'),
      JSON.stringify({
        runId: spec.id,
        skillId: 'x/sk',
        skillDigest: 'sha256:deadbeef',
        git: { commit: null, dirty: false },
        provenance: {},
        toolLock: {},
      }),
    )
    for (const [stage, findings] of Object.entries(spec.stages)) {
      const stageDir = join(runDir, `${NUMBER[stage] as string}-${stage}`)
      await mkdir(stageDir, { recursive: true })
      await writeFile(join(stageDir, 'stage.json'), stageJson(stage, findings))
      if (spec.withPrompt?.includes(stage)) {
        await writeFile(join(stageDir, 'fix-prompt.md'), `# stored prompt for ${stage}\n`)
      }
    }
    await writeFile(
      join(runsRoot, 'index.ndjson'),
      `${JSON.stringify({ runId: spec.id, outcome: 'failed', endedAt: '2026-08-04T00:00:00Z' })}\n`,
      { flag: 'a' },
    )
  }

  const out: string[] = []
  const program = buildProgram({
    home,
    dbPath: join(home, 'gantry.db'),
    write: (line) => out.push(line),
  })
  const run = (argv: string[]) => program.parseAsync(['node', 'skillgantry', ...argv])
  return { home, repo, ws, runsRoot, out, program, run }
}

/** Every file under a directory, by content hash — for the never-writes check. */
async function fingerprint(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[path] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
  return out
}

describe('R12.6 skillgantry fix', () => {
  it('prints the stored prompt for the only stage that found something', async () => {
    const { out, program, run } = await harness([
      { id: 'run-1', stages: { security: [FINDING] }, withPrompt: ['security'] },
    ])
    await run(['fix', 'sk'])
    expect(out.join('\n')).toContain('# stored prompt for security')
    expect(program.exitCode).toBe(0)
  })

  it('defaults to the greatest run id, and --run overrides it', async () => {
    const { out, run } = await harness([
      { id: 'run-1', stages: { security: [FINDING] }, withPrompt: ['security'] },
      { id: 'run-2', stages: { validate: [FINDING] }, withPrompt: ['validate'] },
    ])
    await run(['fix', 'sk'])
    expect(out.join('\n')).toContain('stored prompt for validate')

    out.length = 0
    await run(['fix', 'sk', '--run', 'run-1'])
    expect(out.join('\n')).toContain('stored prompt for security')
  })

  it('lists rather than concatenating when two stages carry prompts', async () => {
    const { out, program, run } = await harness([
      {
        id: 'run-1',
        stages: { validate: [FINDING], security: [FINDING] },
        withPrompt: ['validate', 'security'],
      },
    ])
    await run(['fix', 'sk'])
    expect(out.some((l) => l.startsWith('validate  '))).toBe(true)
    expect(out.some((l) => l.startsWith('security  '))).toBe(true)
    expect(out).toContain('pass --stage <name> to print one')
    expect(out.join('\n')).not.toContain('stored prompt')
    expect(program.exitCode).toBe(0)
  })

  it('--stage restricts to one', async () => {
    const { out, run } = await harness([
      {
        id: 'run-1',
        stages: { validate: [FINDING], security: [FINDING] },
        withPrompt: ['validate', 'security'],
      },
    ])
    await run(['fix', 'sk', '--stage', 'security'])
    expect(out.join('\n')).toContain('stored prompt for security')
    expect(out.join('\n')).not.toContain('stored prompt for validate')
  })

  it('exits 1 on a clean run, saying why', async () => {
    const { out, program, run } = await harness([{ id: 'run-1', stages: { security: [] } }])
    await run(['fix', 'sk'])
    expect(out.join('\n')).toContain('no findings in run run-1 — nothing to fix')
    expect(program.exitCode).toBe(1)
  })

  it('regenerates in memory when the run predates the prompt', async () => {
    // Run 019fcd9e's case: findings on record, no fix-prompt.md beside them.
    const { out, program, run } = await harness([{ id: 'run-1', stages: { security: [FINDING] } }])
    await run(['fix', 'sk', '--stage', 'security'])
    const body = out.join('\n')
    expect(body).toContain('# Fix the security findings on')
    expect(body).toContain('LP3')
    expect(program.exitCode).toBe(0)
  })

  it('never writes: the sidecar is byte-identical afterwards', async () => {
    const { runsRoot, run } = await harness([{ id: 'run-1', stages: { security: [FINDING] } }])
    const before = await fingerprint(runsRoot)
    await run(['fix', 'sk', '--stage', 'security'])
    expect(await fingerprint(runsRoot)).toEqual(before)
  })

  it('--json emits one document carrying onDisk and the body', async () => {
    const { out, run } = await harness([{ id: 'run-1', stages: { security: [FINDING] } }])
    await run(['fix', 'sk', '--json'])
    expect(out).toHaveLength(1)
    const doc = JSON.parse(out[0] as string) as {
      skillId: string
      runId: string
      prompts: Array<{ stage: string; onDisk: boolean; findings: number; highestSeverity: string; body: string }>
    }
    expect(doc.runId).toBe('run-1')
    expect(doc.prompts).toHaveLength(1)
    expect(doc.prompts[0]).toMatchObject({
      stage: 'security',
      onDisk: false,
      findings: 1,
      highestSeverity: 'medium',
    })
    expect(doc.prompts[0]?.body).toContain('LP3')
  })

  it('marks a stored prompt onDisk', async () => {
    const { out, run } = await harness([
      { id: 'run-1', stages: { security: [FINDING] }, withPrompt: ['security'] },
    ])
    await run(['fix', 'sk', '--json'])
    const doc = JSON.parse(out[0] as string) as { prompts: Array<{ onDisk: boolean }> }
    expect(doc.prompts[0]?.onDisk).toBe(true)
  })

  it('rejects an unknown run id, stage and skill, each naming what was wrong', async () => {
    const { run } = await harness([{ id: 'run-1', stages: { security: [FINDING] } }])
    await expect(run(['fix', 'sk', '--run', 'nope'])).rejects.toThrow(/no run nope recorded/)
    await expect(run(['fix', 'sk', '--stage', 'wat'])).rejects.toThrow(/unknown stage: wat/)
    await expect(run(['fix', 'sk', '--stage', 'evaluate'])).rejects.toThrow(
      /did not execute the evaluate stage/,
    )
    await expect(run(['fix', 'nosuch'])).rejects.toThrow(/no skill matching/)
  })
})
