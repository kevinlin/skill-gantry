import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface RepoSpec {
  /** Relative path -> file contents. Directories are created as needed. */
  files: Record<string, string>
}

export async function makeRepo(spec: RepoSpec): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillgantry-'))
  for (const [rel, contents] of Object.entries(spec.files)) {
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents)
  }
  return root
}

export const SKILL_MD = (name: string, version = '1.0.0'): string =>
  `---\nname: ${name}\nmetadata:\n  version: ${version}\n---\n\n# ${name}\n`

/**
 * A committed repo, because a worktree starts at HEAD: `git worktree add HEAD`
 * against a repo with no commit fails with an unhelpful invalid-reference error.
 */
export async function makeGitRepo(spec: RepoSpec): Promise<string> {
  const root = await makeRepo(spec)
  await run('git', ['init', '-q', '.'], { cwd: root })
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
  await run('git', ['config', 'user.name', 'test'], { cwd: root })
  await run('git', ['add', '-A'], { cwd: root })
  await run('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

/**
 * `SKILL_MD` with a description, which vercel `skills` requires before it will
 * install a directory — so every release fixture needs one. `SKILL_MD` itself is
 * left alone: adding a line to it changes the bytes every existing digest and
 * fingerprint test is built on.
 */
export const SKILL_MD_FULL = (
  name: string,
  version = '1.0.0',
  description = `the ${name} skill`,
): string =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  version: ${version}\n---\n\n# ${name}\n`

export interface CliFixtureSpec {
  /** Tool ids to seed into `tools/lock.json`. Defaults to SkillHone alone. */
  lockTools?: readonly string[]
  /** Writes one recorded run under the sidecar. */
  seedRun?: 'suppressed-and-actionable'
}

export interface CliFixture {
  home: string
  repo: string
  runsRoot: string
  /** The seeded run's id, or null when `seedRun` was not asked for. */
  runId: string | null
  out: string[]
  deps: { home: string; dbPath: string; write: (line: string) => void }
}

const RUN_ID = '019fe5c3'

/**
 * A home, one skill repo holding `declawed/`, a seeded tool lock and a `CliDeps`
 * pointing at both — everything a subcommand test needs and nothing a run needs,
 * since no pipeline executes here.
 */
export async function makeCliFixture(spec: CliFixtureSpec = {}): Promise<CliFixture> {
  const { DEFAULT_CONFIG, registerRepo, saveConfig, saveToolLock } = await import(
    '../../src/core/config/config.js'
  )
  const { workspacePath } = await import('../../src/core/discovery/discover.js')

  const home = await mkdtemp(join(tmpdir(), 'sg-cli-'))
  const repo = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD_FULL('declawed') } })
  await saveConfig(home, DEFAULT_CONFIG)
  await registerRepo(home, repo)

  const ids = spec.lockTools ?? ['skillhone']
  await saveToolLock(home, {
    version: 1,
    tools: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          installKind: 'git-skill' as const,
          requestedPin: 'c'.repeat(40),
          resolvedVersion: 'c'.repeat(40),
          bin: join(home, 'tools', id, '.venv', 'bin', 'python'),
          integrity: 'n/a',
          links: [join(home, '.agents', 'skills', id)],
          installedAt: '2026-08-09T00:00:00Z',
          verifiedAt: '2026-08-09T00:00:00Z',
        },
      ]),
    ),
  })

  const runsRoot = join(workspacePath(repo, 'declawed', false), 'skillgantry', 'runs')
  await mkdir(runsRoot, { recursive: true })

  let runId: string | null = null
  if (spec.seedRun === 'suppressed-and-actionable') {
    runId = RUN_ID
    const runDir = join(runsRoot, runId)
    const stageDir = join(runDir, '03-security')
    const artefactDir = join(stageDir, 'skillspector')
    await mkdir(artefactDir, { recursive: true })
    await writeFile(
      join(runDir, 'run.json'),
      JSON.stringify({
        runId,
        skillId: 'x/declawed',
        skillDigest: 'sha256:7f3a',
        git: { commit: 'a1b2c3d', dirty: false },
        provenance: {},
        toolLock: {},
      }),
    )
    await writeFile(
      join(stageDir, 'stage.json'),
      JSON.stringify({
        stage: 'security',
        outcome: 'failed',
        verdict: 'failed',
        toolRuns: [
          {
            toolId: 'skillspector',
            toolVersion: '2.5.1',
            outcome: 'failed',
            exitCode: 1,
            durationMs: 10,
            errorKind: null,
            artefactDir,
            findings: [
              {
                ruleClass: 'prompt-injection',
                nativeRuleId: 'P2',
                severity: 'high',
                path: 'SKILL.md',
                line: 58,
                message: 'interpolates untrusted text',
              },
              {
                ruleClass: 'unsafe-script',
                nativeRuleId: 'MP2',
                severity: 'medium',
                path: 'scripts/scan.py',
                line: 3,
                message: 'alignment whitespace',
                suppressed: { justification: 'alignment in a re.VERBOSE block' },
              },
            ],
            metrics: {},
            summary: '2 findings',
          },
        ],
      }),
    )
    await writeFile(
      join(runsRoot, 'index.ndjson'),
      `${JSON.stringify({ runId, outcome: 'failed', endedAt: '2026-08-09T00:00:00Z' })}\n`,
    )
  }

  const out: string[] = []
  return {
    home,
    repo,
    runsRoot,
    runId,
    out,
    deps: { home, dbPath: join(home, 'gantry.db'), write: (line: string) => out.push(line) },
  }
}
