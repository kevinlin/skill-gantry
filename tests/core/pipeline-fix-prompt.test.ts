import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverSkills, workspacePath } from '../../src/core/discovery/discover.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline } from '../../src/core/pipeline/run.js'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import type { StageExecutor } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef } from '../../src/core/types.js'
import { fixPromptPathFor } from '../../src/core/workspace/layout.js'
import { fakeExecutor } from '../helpers/fake-executor.js'
import { makeFakeMutatingTool } from '../helpers/fake-mutating-tool.js'
import { SKILL_MD, SKILL_MD_FULL, makeGitRepo, makeRepo } from '../helpers/tmp-repo.js'

const FINDING: RawFinding = {
  ruleClass: 'excessive-permission',
  nativeRuleId: 'LP3',
  severity: 'medium',
  path: 'declawed/SKILL.md',
  line: 1,
  message: 'no declared permissions but code capabilities were detected: file_read',
}

const EMPTY_LOCK = { version: 1 as const, tools: {} }

async function harness(files: Record<string, string>) {
  const repoPath = await makeRepo({ files })
  const repo = { id: 'fx', path: repoPath, name: 'fx', isGit: false }
  const [skill] = await discoverSkills(repo)
  return { repoPath, skill: skill as SkillRef, ledger: openLedger(':memory:') }
}

const start = (skill: SkillRef, ledger: ReturnType<typeof openLedger>, exec: StageExecutor) =>
  runPipeline({
    skill,
    stages: ['security'],
    trigger: 'test',
    stageTools: { security: ['fake'] },
    lock: EMPTY_LOCK,
    ledger,
    env: {},
    secrets: [],
    provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
    artefactSizeCapBytes: 1_000_000,
    timeoutOverridesMs: {},
    executorFactory: () => exec,
  }).done

const readPrompt = async (runDir: string): Promise<string | null> => {
  try {
    return await readFile(fixPromptPathFor(runDir, 'security'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

describe('R6.10 the fix prompt through the pipeline', () => {
  it('writes none when the stage reported no finding', async () => {
    const { skill, ledger } = await harness({ 'declawed/SKILL.md': SKILL_MD('declawed') })
    const summary = await start(skill, ledger, fakeExecutor('security'))
    expect(summary.stages[0]?.outcome).toBe('passed')
    expect(await readPrompt(summary.runDir)).toBeNull()
  })

  it('writes exactly one beside stage.json when a tool reported a finding', async () => {
    const { skill, ledger } = await harness({ 'declawed/SKILL.md': SKILL_MD('declawed') })
    const summary = await start(
      skill,
      ledger,
      fakeExecutor('security', { outcome: 'failed', findings: [FINDING] }),
    )
    const body = await readPrompt(summary.runDir)
    expect(body).toContain('# Fix the security findings on')
    expect(body).toContain('LP3')
    // Beside stage.json, in the same stage directory.
    const stageDir = join(summary.runDir, '03-security')
    expect(await readFile(join(stageDir, 'stage.json'), 'utf8')).toContain('LP3')
    expect(fixPromptPathFor(summary.runDir, 'security')).toBe(join(stageDir, 'fix-prompt.md'))
  })

  it('writes one for a sub-floor stage that passed', async () => {
    // §8.1's sub-floor row: the tool passes and the finding is still filed, so
    // an outcome-based trigger would drop exactly the case still open.
    const { skill, ledger } = await harness({ 'declawed/SKILL.md': SKILL_MD('declawed') })
    const summary = await start(
      skill,
      ledger,
      fakeExecutor('security', { findings: [{ ...FINDING, severity: 'low' }] }),
    )
    expect(summary.stages[0]?.outcome).toBe('passed')
    expect(await readPrompt(summary.runDir)).toContain('LP3')
  })

  it('names the real skill directory, not the materialised candidate', async () => {
    // A repo-root skill is the R2.11 case: {skillDir} is a temp copy, and a
    // prompt pointing an agent there would send it to edit bytes that vanish.
    const { repoPath, skill, ledger } = await harness({ 'SKILL.md': SKILL_MD('rooted') })
    expect(skill.rootSkill).toBe(true)
    const summary = await start(
      skill,
      ledger,
      fakeExecutor('security', { outcome: 'failed', findings: [FINDING] }),
    )
    const body = (await readPrompt(summary.runDir)) as string
    expect(body).toContain(`| Skill directory | \`${repoPath}\` |`)
    expect(body).not.toContain('sg-candidate-')
  })
})

describe('R6.10 on the abort paths', () => {
  const OPTIMISED = SKILL_MD_FULL('sk', '1.0.0', 'rewritten by the optimiser')

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
    parse: () => ({
      outcome: 'failed' as const,
      findings: [{ ...FINDING, path: 'sk/SKILL.md' }],
      metrics: {},
      summary: 'rewrote',
    }),
    bin,
  })

  async function mutatingHarness() {
    const repo = await makeGitRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
    const skill: SkillRef = {
      id: 'repo/sk',
      name: 'sk',
      version: '1.0.0',
      dir: join(repo, 'sk'),
      relPath: 'sk',
      repo: { id: 'repo', path: repo, name: 'repo', isGit: true },
      rootSkill: false,
      frontmatterReadable: true,
      workspacePath: workspacePath(repo, 'sk', false),
      deprecated: false,
      supersededBy: null,
    }
    const tool = await makeFakeMutatingTool(OPTIMISED)
    const adapter = fakeAdapter(tool.bin)
    return {
      repo,
      skill,
      start: (over: Record<string, unknown>) =>
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
          ledger: openLedger(':memory:'),
          env: process.env,
          secrets: [],
          provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
          artefactSizeCapBytes: 1_000_000,
          timeoutOverridesMs: {},
          executorFactory: () =>
            new AdapterStageExecutor('optimise', {
              lookup: (id) => (id === 'fake-optimiser' ? adapter : undefined),
            }),
          ...over,
        }),
    }
  }

  it('writes none when the sandbox refused to open', async () => {
    // The synthetic tool run on that path carries findings: [] by construction,
    // so the one hook produces nothing rather than a second hook producing a
    // prompt about a stage that never ran.
    const { repo, start } = await mutatingHarness()
    await writeFile(join(repo, 'sk/SKILL.md'), 'dirty, uncommitted\n')
    const summary = await start({ authorised: true }).done
    expect(summary.stages[0]?.toolRuns[0]?.errorKind).toBe('mutation-aborted')
    expect(await readPromptFor(summary.runDir)).toBeNull()
  })

  it('writes one for a row-3b abort whose tool had already reported findings', async () => {
    const { repo, start } = await mutatingHarness()
    const handle = start({ authorised: true })
    void (async () => {
      for await (const event of handle.events) {
        if (event.type === 'mutation:pending') {
          // R10.11's window: the user edits while the diff sits on screen.
          await writeFile(join(repo, 'sk/SKILL.md'), 'hand-edited\n')
          handle.resolveMutation(event.requestId, 'apply')
        }
      }
    })()
    const summary = await handle.done
    expect(summary.stages[0]?.toolRuns.at(-1)?.errorKind).toBe('mutation-aborted')
    // R5.13 keeps the partial evidence, and the prompt is part of it.
    expect(await readPromptFor(summary.runDir)).toContain('LP3')
  })
})

const readPromptFor = async (runDir: string): Promise<string | null> => {
  try {
    return await readFile(fixPromptPathFor(runDir, 'optimise'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
