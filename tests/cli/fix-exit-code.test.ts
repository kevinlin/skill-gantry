import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, registerRepo, saveConfig } from '../../src/core/config/config.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

const TMP_DIR = join(process.cwd(), 'tests', 'tmp')

/**
 * `tests/helpers/child.ts` returns stdout and rejects on a non-zero exit, which
 * is precisely what this contract needs to observe, so the code is captured
 * here instead. The second process is the point: R12.6 binds the code the
 * *process* exits with, and `src/cli/index.ts:6` is the line that assigns it —
 * asserting `program.exitCode` in process cannot reach it.
 */
async function runChild(source: string): Promise<{ code: number; stdout: string }> {
  await mkdir(TMP_DIR, { recursive: true })
  const file = join(TMP_DIR, `child-${randomUUID()}.ts`)
  await writeFile(file, source)
  try {
    return await new Promise((resolve, reject) => {
      execFile(
        'pnpm',
        ['exec', 'tsx', file],
        { cwd: process.cwd() },
        (err, stdout) => {
          const code = (err as (Error & { code?: number }) | null)?.code
          if (err && typeof code !== 'number') reject(err)
          else resolve({ code: code ?? 0, stdout })
        },
      )
    })
  } finally {
    await rm(file, { force: true })
  }
}

/** The three lines of `src/cli/index.ts`, over a home the test controls. */
const child = (home: string, argv: string[]) => `
import { buildProgram } from '../../src/cli/run-command.js'
const program = buildProgram({
  home: ${JSON.stringify(home)},
  dbPath: ${JSON.stringify(join(home, 'gantry.db'))},
  write: (line) => console.log(line),
})
await program.parseAsync(['node', 'skillgantry', ${argv.map((a) => JSON.stringify(a)).join(', ')}])
process.exitCode = program.exitCode ?? 0
`

async function harness(findings: unknown[]) {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  await saveConfig(home, DEFAULT_CONFIG)
  await registerRepo(home, repo)

  const runsRoot = join(workspacePath(repo, 'sk', false), 'skillgantry', 'runs')
  const runDir = join(runsRoot, 'run-1')
  await mkdir(join(runDir, '03-security'), { recursive: true })
  await writeFile(
    join(runDir, 'run.json'),
    JSON.stringify({
      runId: 'run-1',
      skillId: 'x/sk',
      skillDigest: 'sha256:deadbeef',
      git: { commit: null, dirty: false },
    }),
  )
  await writeFile(
    join(runDir, '03-security', 'stage.json'),
    JSON.stringify({
      stage: 'security',
      outcome: findings.length > 0 ? 'failed' : 'passed',
      verdict: findings.length > 0 ? 'failed' : 'passed',
      toolRuns: [
        {
          toolId: 'skillspector',
          toolVersion: '2.5.1',
          outcome: 'failed',
          exitCode: 1,
          durationMs: 1,
          errorKind: null,
          artefactDir: join(runDir, '03-security', 'skillspector'),
          findings,
          metrics: {},
          summary: 'x',
        },
      ],
    }),
  )
  await writeFile(
    join(runsRoot, 'index.ndjson'),
    `${JSON.stringify({ runId: 'run-1', outcome: 'failed', endedAt: 'now' })}\n`,
  )
  return home
}

describe('R12.6 exit code across the process boundary', () => {
  it('exits 0 when a prompt reached stdout', async () => {
    const home = await harness([
      {
        ruleClass: 'excessive-permission',
        nativeRuleId: 'LP3',
        severity: 'medium',
        path: 'sk/SKILL.md',
        line: 1,
        message: 'no declared permissions',
      },
    ])
    const { code, stdout } = await runChild(child(home, ['fix', 'sk', '--stage', 'security']))
    expect(stdout).toContain('LP3')
    expect(code).toBe(0)
  }, 60_000)

  it('exits 1 on a clean run — not because the skill failed, but because there is nothing to print', async () => {
    const home = await harness([])
    const { code, stdout } = await runChild(child(home, ['fix', 'sk']))
    expect(stdout).toContain('nothing to fix')
    expect(code).toBe(1)
  }, 60_000)
})
