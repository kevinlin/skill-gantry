import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ReleaseStageExecutor } from '../../src/core/stages/release-stage.js'
import { openSandbox } from '../../src/core/isolation/open.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { type Exec, defaultExec } from '../../src/core/tools/exec.js'
import type { StageContext } from '../../src/core/stages/types.js'
import type { Ledger } from '../../src/core/ledger/db.js'
import type { SkillRef, Stage } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

const execFileP = promisify(execFile)

/** Answers like vercel `skills` 1.5.21 does, per the probed facts. */
async function fakeSkills(exitCode = 0): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
  const bin = join(dir, 'skills')
  await writeFile(
    bin,
    exitCode === 0
      ? '#!/bin/sh\necho "Installed 1 skill"\nexit 0\n'
      : '#!/bin/sh\necho "No valid skills found." >&2\nexit 1\n',
  )
  await chmod(bin, 0o755)
  return bin
}

async function scene(
  opts: {
    manifest?: boolean
    skillsExit?: number
    corruptManifest?: boolean
    files?: Record<string, string>
  } = {},
) {
  const withManifest = opts.manifest !== false
  const repo = await makeGitRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      ...opts.files,
      ...(opts.corruptManifest
        ? { 'versions.json': '{ not valid json' }
        : withManifest
          ? { 'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n' }
          : {}),
    },
  })
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
  const digest = await skillDigest(await candidateManifest(skill))
  const ledger = openLedger(':memory:')
  passGates(ledger, skill, digest)

  const runDir = join(skill.workspacePath, 'skillgantry', 'runs', 'run-rel')
  await mkdir(runDir, { recursive: true })
  const bin = await fakeSkills(opts.skillsExit ?? 0)

  const ctx = (over: Partial<StageContext> = {}): StageContext => ({
    skill,
    stage: 'release' as Stage,
    stageDir: join(runDir, '05-release'),
    runDir,
    selectedToolIds: [],
    lock: {
      version: 1,
      tools: {
        skills: {
          installKind: 'npm-prefix',
          requestedPin: '1.5.21',
          resolvedVersion: '1.5.21',
          bin,
          integrity: 'n/a',
          installedAt: 'now',
          verifiedAt: 'now',
        },
      },
    },
    env: process.env,
    secrets: [],
    artefactSizeCapBytes: 1_000_000,
    timeoutOverridesMs: {},
    onOutput: () => undefined,
    authorised: true,
    releaseTarget: { version: 'minor' },
    ...over,
  })

  return { repo, skill, ledger, runDir, ctx, digest }
}

function passGates(ledger: Ledger, skill: SkillRef, digest: string, runId = '019000000000-a'): void {
  recordRun(ledger, {
    skill,
    runId,
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: digest,
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: join(skill.workspacePath, 'skillgantry', 'runs', runId),
    stages: (['validate', 'evaluate', 'security'] as Stage[]).map((stage) => ({
      stage,
      outcome: 'passed' as const,
      verdict: 'passed' as const,
      toolRuns: [],
    })),
  })
}

/** The pipeline's job, done by hand so the executor is testable in isolation. */
async function run(s: Awaited<ReturnType<typeof scene>>, over: Partial<StageContext> = {}) {
  const executor = new ReleaseStageExecutor({ ledger: s.ledger })
  const base = s.ctx(over)
  const plan = await executor.plan(base)
  const sandbox =
    base.authorised && plan.mutationScope.paths.length > 0
      ? await openSandbox({
          skill: s.skill,
          stage: 'release',
          runId: 'run-rel',
          recordDir: s.runDir,
          scope: plan.mutationScope.paths,
          // Forwarded, or the 'digest mismatch' scene's deliberately dirty
          // SKILL.md would fail sandbox-open itself, never reaching the
          // precondition refusal the test asserts on.
          ...(base.allowDirty === undefined ? {} : { allowDirty: base.allowDirty }),
        })
      : undefined
  const ctx: StageContext = {
    ...base,
    // What `run.ts:342-350` does, and what this harness used to skip: with the
    // live `skill` left in place, `candidateManifest` and
    // `readVersionsManifest` were exercised against the live tree while
    // production ran them against the sandbox. That blind spot hid the
    // untracked-candidate-file digest mismatch entirely.
    ...(sandbox
      ? {
          skill: {
            ...base.skill,
            dir: sandbox.resolve(base.skill.relPath),
            repo: { ...base.skill.repo, path: sandbox.workRoot },
          },
          sandbox,
        }
      : {}),
  }
  const result = await executor.execute(ctx, plan)
  return { executor, ctx, plan, sandbox, result }
}

describe('ReleaseStageExecutor', () => {
  it('declares a scope spanning the skill, its changelog, the manifest and the archive', async () => {
    const s = await scene()
    const plan = await new ReleaseStageExecutor({ ledger: s.ledger }).plan(s.ctx())
    expect(plan.policy).toBe('native')
    expect(plan.toolIds).toEqual([])
    expect([...plan.mutationScope.paths].sort()).toEqual(
      ['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk_1.1.0.zip', 'versions.json'].sort(),
    )
  })

  it('stages the edits, packages and verifies without touching the live tree', async () => {
    const s = await scene()
    const { result, ctx, executor, sandbox } = await run(s)
    expect(result.outcome).toBe('passed')

    // R9.6a: nothing live yet, including the archive.
    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
    await expect(stat(join(s.repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    await expect(stat(join(s.repo, 'sk/CHANGELOG.md'))).rejects.toThrow()

    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    expect(pending?.diff).toContain('1.1.0')
    expect([...(pending?.scope ?? [])].sort()).toEqual(
      ['sk/CHANGELOG.md', 'sk/SKILL.md', 'sk_1.1.0.zip', 'versions.json'].sort(),
    )
    await sandbox?.dispose()
  })

  it('applies every scoped file and the archive together, and writes the evidence', async () => {
    const s = await scene()
    const { result, ctx, executor, sandbox } = await run(s)
    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    await executor.applyMutation(ctx, pending!)

    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    expect(await readFile(join(s.repo, 'sk/CHANGELOG.md'), 'utf8')).toContain('## 1.1.0')
    expect(JSON.parse(await readFile(join(s.repo, 'versions.json'), 'utf8'))).toEqual({
      skills: { sk: '1.1.0' },
    })
    // R9.4: the archive is an output of the transaction, at the repo root.
    expect((await stat(join(s.repo, 'sk_1.1.0.zip'))).size).toBeGreaterThan(0)

    const evidence = JSON.parse(
      await readFile(join(s.runDir, 'evidence', 'release.json'), 'utf8'),
    ) as { archiveSha256: string; manifestMode: string; candidateManifest: unknown[] }
    expect(evidence.archiveSha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(evidence.manifestMode).toBe('versions.json')
    expect(evidence.candidateManifest.length).toBeGreaterThan(0)

    // R9.7: never a commit. Apply writes bytes directly into the live tree
    // and never shells out to git, so the repo still has only the one commit
    // `makeGitRepo`'s fixture made, and the applied files sit uncommitted.
    const { stdout: log } = await execFileP('git', ['log', '--oneline'], { cwd: s.repo })
    expect(log.trim().split('\n')).toHaveLength(1)
    const { stdout: status } = await execFileP('git', ['status', '--porcelain'], { cwd: s.repo })
    expect(status).toContain('sk/SKILL.md')
    expect(status).toContain('sk_1.1.0.zip')
    await sandbox?.dispose()
  })

  it('releases a repo with no manifest and records the mode', async () => {
    const s = await scene({ manifest: false })
    const { result, ctx, executor, sandbox } = await run(s)
    expect(result.outcome).toBe('passed')
    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    await executor.applyMutation(ctx, pending!)
    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    // R9.1: SkillGantry never creates a versions.json.
    await expect(stat(join(s.repo, 'versions.json'))).rejects.toThrow()
    const evidence = JSON.parse(await readFile(join(s.runDir, 'evidence', 'release.json'), 'utf8')) as {
      manifestMode: string
    }
    expect(evidence.manifestMode).toBe('none')
    await sandbox?.dispose()
  })

  it('fails and leaves no repo-root archive when the installability gate refuses', async () => {
    const s = await scene({ skillsExit: 1 })
    const { result, ctx, executor, sandbox } = await run(s)
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.errorKind).toBeNull()
    expect(result.toolRuns[0]?.summary).toContain('No valid skills found')
    await expect(stat(join(s.repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')

    // R9.11: a failed release has nothing worth previewing or applying. A
    // pending mutation here is what let a refused release still prompt for
    // approval and, on apply, write a half release with no archive and no
    // evidence — the bug this guard exists to close.
    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    expect(pending).toBeNull()
    await sandbox?.dispose()
  })

  it('applies the archive into a repo whose .gitignore excludes it', async () => {
    // `*.zip` is a common convention. `git add -A` honours `.gitignore`, so the
    // archive was silently absent from the change set, absent from the journal
    // and never written — while `evidence/release.json` recorded its SHA-256
    // and the stage still reported `passed`. R9.4 silently unmet.
    const s = await scene({ files: { '.gitignore': '*.zip\n' } })
    const { result, ctx, executor, sandbox } = await run(s)
    expect(result.outcome).toBe('passed')
    const pending = await executor.prepareMutation(ctx, await executor.plan(ctx), result)
    expect(pending?.scope).toContain('sk_1.1.0.zip')
    await executor.applyMutation(ctx, pending!)
    expect((await stat(join(s.repo, 'sk_1.1.0.zip'))).size).toBeGreaterThan(0)
    await sandbox?.dispose()
  })

  it('refuses to open a sandbox over an uncommitted candidate file outside the scope', async () => {
    // The sandbox is HEAD plus the seeded paths, and the digest is taken over
    // it, so an untracked candidate file used to surface as `digest-mismatch`
    // telling the user to re-run gates that would reproduce the same digest.
    // R10.3 now names the uncommitted work instead.
    const s = await scene()
    await writeFile(join(s.repo, 'sk/reference.md'), 'notes\n')
    await expect(run(s)).rejects.toThrow(/uncommitted changes[\s\S]*sk\/reference\.md/)
  })

  it('seeds an uncommitted candidate file under the override so the digest agrees', async () => {
    const s = await scene()
    await writeFile(join(s.repo, 'sk/reference.md'), 'notes\n')
    // Gates re-seeded for the bytes as they now stand: the live digest and the
    // sandbox digest have to agree once the override seeds the file.
    const digest = await skillDigest(await candidateManifest(s.skill))
    passGates(s.ledger, s.skill, digest, '019000000000-b')
    const { result, sandbox } = await run(s, { allowDirty: true })
    expect(result.outcome).toBe('passed')
    await sandbox?.dispose()
  })

  it('refuses on a digest mismatch, naming the requirement', async () => {
    const s = await scene()
    await writeFile(join(s.repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'edited after the gates'))
    const { result, sandbox } = await run(s, { allowDirty: true })
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.summary).toContain('R9.9')
    await sandbox?.dispose()
  })

  it('refuses a deprecated skill while the gates still pass', async () => {
    const s = await scene()
    const { result, sandbox } = await run(s, {
      skill: { ...s.skill, deprecated: true },
    })
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.summary).toContain('deprecated')
    await sandbox?.dispose()
  })

  it('skips with not-installed when vercel skills is absent from the lock', async () => {
    const s = await scene()
    const { result } = await run(s, { lock: { version: 1, tools: {} } })
    expect(result.outcome).toBe('skipped')
    expect(result.toolRuns[0]?.errorKind).toBe('not-installed')
  })

  it('skips with no-authorisation and never opens a sandbox', async () => {
    const s = await scene()
    const { result, sandbox } = await run(s, { authorised: false })
    expect(sandbox).toBeUndefined()
    expect(result.outcome).toBe('skipped')
    expect(result.toolRuns[0]?.errorKind).toBe('no-authorisation')
  })

  it('refuses a present but unparseable versions.json rather than silently ignoring it', async () => {
    const s = await scene({ corruptManifest: true })
    const { result, sandbox } = await run(s)
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.summary).toContain('R9.2')
    expect(result.toolRuns[0]?.summary).toContain('versions.json')
    await sandbox?.dispose()
  })

  it('refuses when no target version was supplied — R9.10', async () => {
    const s = await scene()
    const { result } = await run(s, { releaseTarget: undefined })
    expect(result.outcome).toBe('failed')
    expect(result.toolRuns[0]?.summary).toContain('no target version')
  })

  it('R9.6a: verify-install runs against a live tree that packaging has not touched', async () => {
    // Intercepts the moment vercel `skills` is invoked (verify-install) and
    // asserts the live repo is still untouched right then — not merely at the
    // end, which a test could pass even if a write happened and was undone.
    const s = await scene()
    const base = s.ctx()
    const skillsBin = (base.lock.tools.skills as { bin: string }).bin
    let checkedDuringVerify = false
    const exec: Exec = async (bin, argv, options) => {
      if (bin === skillsBin) {
        const stillOriginal = (await readFile(join(s.repo, 'sk/SKILL.md'), 'utf8')).includes('1.0.0')
        const archiveAbsent = await stat(join(s.repo, 'sk_1.1.0.zip')).then(
          () => false,
          () => true,
        )
        checkedDuringVerify = stillOriginal && archiveAbsent
      }
      return defaultExec(bin, argv, options)
    }

    const executor = new ReleaseStageExecutor({ ledger: s.ledger, exec })
    const plan = await executor.plan(base)
    const sandbox = await openSandbox({
      skill: s.skill,
      stage: 'release',
      runId: 'run-rel',
      recordDir: s.runDir,
      scope: plan.mutationScope.paths,
    })
    const ctx: StageContext = { ...base, sandbox }
    const result = await executor.execute(ctx, plan)

    expect(result.outcome).toBe('passed')
    expect(checkedDuringVerify).toBe(true)
    await sandbox.dispose()
  })
})
