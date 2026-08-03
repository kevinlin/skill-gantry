import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildProgram } from '../../src/cli/run-command.js'
import {
  DEFAULT_CONFIG,
  loadConfig,
  registerRepo,
  saveConfig,
  saveToolLock,
} from '../../src/core/config/config.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { runPipeline } from '../../src/core/pipeline/run.js'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import type { Adapter } from '../../src/core/adapters/types.js'
import type { SkillRef, Stage } from '../../src/core/types.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { catalogueEntry } from '../../src/core/tools/catalogue.js'
import { installTool } from '../../src/core/tools/install.js'
import { RELEASE_TOOL_ID } from '../../src/core/tools/catalogue.js'
import { SKILL_MD, SKILL_MD_FULL, makeGitRepo, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { CORE, runInChild } from '../helpers/child.js'

const execFileP = promisify(execFile)

interface Harness {
  home: string
  dbPath: string
  out: string[]
  exec(args: string[]): Promise<number>
}

/**
 * A CLI harness over a repo already registered in `home`'s config, following
 * `tests/acceptance/m4.test.ts`'s shape. Each case builds its own repo, so this
 * only wires the parts every case needs.
 */
async function cliHome(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-m5-home-'))
  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return {
    home,
    dbPath,
    out,
    exec: async (args) => {
      const program = buildProgram({ home, dbPath, write: (l) => out.push(l) })
      await program.exitOverride().parseAsync(['node', 'skillgantry', ...args])
      return program.exitCode ?? 0
    },
  }
}

/** vercel `skills` 1.5.21's own shape, per the probed facts in plan-m5.md. */
async function fakeSkillsBin(exitCode: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-m5-skills-'))
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

const skillsLockEntry = (bin: string) => ({
  installKind: 'npm-prefix' as const,
  requestedPin: '1.5.21',
  resolvedVersion: '1.5.21',
  bin,
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
})

const lintLockEntry = (bin: string) => ({
  installKind: 'npm-prefix' as const,
  requestedPin: '0.2.0',
  resolvedVersion: '0.2.0',
  bin,
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
})

/** All three of `GATE_STAGES`, passed against the given digest, in one run. */
function seedGatesPassed(
  ledger: ReturnType<typeof openLedger>,
  skill: SkillRef,
  digest: string,
  runId = 'gates-pass-1',
): void {
  recordRun(ledger, {
    skill,
    runId,
    trigger: 'test',
    startedAt: '2026-08-01T00:00:00Z',
    endedAt: '2026-08-01T00:01:00Z',
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

/**
 * Opens `dbPath`'s ledger, seeds all three gates against the skill's *current*
 * on-disk bytes, and closes it again. The six call sites this replaces each
 * computed the same digest by hand before seeding — one helper, not six
 * copies of `candidateManifest` → `skillDigest` → `seedGatesPassed`.
 */
async function seedGatesForCurrentBytes(dbPath: string, skill: SkillRef, runId?: string): Promise<string> {
  const digest = await skillDigest(await candidateManifest(skill))
  const ledger = openLedger(dbPath)
  seedGatesPassed(ledger, skill, digest, runId)
  ledger.close()
  return digest
}

/**
 * The release stage's own synthesised tool run — filtered on `s.stage =
 * 'release'`, not just "most recent run": a bare `order by r.rowid desc
 * limit 1` with no stage filter picks an arbitrary row once a run carries
 * more than one stage (a seeded gates run does, with three), which is exactly
 * the ambiguity a fingerprint-free query like this must not have.
 */
function latestReleaseToolRun(
  dbPath: string,
): { errorKind: string | null; outcome: string } | undefined {
  const ledger = openLedger(dbPath)
  try {
    return ledger.db
      .prepare(
        `select tr.error_kind as errorKind, tr.outcome as outcome
         from tool_runs tr
         join stages s on s.id = tr.stage_id
         join runs r on r.id = s.run_id
         where s.stage = 'release'
         order by r.rowid desc limit 1`,
      )
      .get() as { errorKind: string | null; outcome: string } | undefined
  } finally {
    ledger.close()
  }
}

const runDirOf = async (workspacePath: string): Promise<string> => {
  const runs = join(workspacePath, 'skillgantry', 'runs')
  const dirs = (await readdir(runs, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  return join(runs, dirs.at(-1) as string)
}

/** Recursive content+mode digest of a tree, workspace and `.git` excluded. */
async function treeDigest(root: string, dir = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const abs = join(root, dir)
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    // `.gitignore` is a permanent side effect of every run (R2.12), written
    // before the digest or the sandbox even exist — not part of what a
    // discarded mutation is supposed to leave untouched.
    if (entry.name === '.git' || entry.name === '.gitignore' || entry.name.endsWith('-workspace')) continue
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    const entryAbs = join(abs, entry.name)
    if (entry.isDirectory()) {
      Object.assign(out, await treeDigest(root, rel))
      continue
    }
    const info = await lstat(entryAbs)
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(entryAbs)) : await readFile(entryAbs)
    out[rel] = `${info.mode}:${createHash('sha256').update(bytes).digest('hex')}`
  }
  return out
}

/**
 * The bytes the tool writes into `bin.dat`. A NUL byte is what both the git
 * and the snapshot strategy's own binary detection key on (`git`'s own
 * heuristic and `looksBinary`'s `includes(0)` respectively), and it is not
 * valid UTF-8, so a test that accidentally read it as text would fail loudly
 * rather than silently passing on the wrong encoding.
 */
const BINARY_BYTES = Buffer.from([0, 1, 2, 3, 4, 5, 0xff, 0xfe])

/**
 * Stands in for an optimise tool exercising all five of R10.8's change kinds,
 * binary included, in one pass: `$1` is the sandboxed skill directory, `$2`
 * the tool's own artefact directory. Real bytes, a real shell script — only
 * the adapter registration is fake, because optimise ships none (plan-m5.md's
 * known gap).
 */
async function makeFiveKindTool(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-m5-fivekind-'))
  const bin = join(dir, 'fake-optimiser')
  // printf's octal escapes, not a base64/heredoc round trip: this is a shell
  // script writing real binary bytes, the same way the other four kinds are
  // real text-file operations rather than a fixture pretending to be one.
  const printfOctal = [...BINARY_BYTES].map((b) => `\\${b.toString(8).padStart(3, '0')}`).join('')
  await writeFile(
    bin,
    [
      '#!/bin/sh',
      'set -e',
      `cat > "$1/SKILL.md" <<'SKILLGANTRY_EOF'\n${SKILL_MD_FULL('sk', '1.1.0')}SKILLGANTRY_EOF`,
      'echo "added by the optimiser" > "$1/added.txt"',
      'rm "$1/old.txt"',
      'mv "$1/rename-me.txt" "$1/renamed.txt"',
      'chmod 644 "$1/exec.sh"',
      `printf '${printfOctal}' > "$1/bin.dat"`,
      'printf \'{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"fake"}},"results":[]}]}\' > "$2/findings.sarif"',
      'exit 0',
    ].join('\n'),
  )
  await chmod(bin, 0o755)
  return bin
}

const fiveKindAdapter = (): Adapter => ({
  manifest: {
    id: 'fake-optimiser',
    stage: 'optimise',
    policy: 'pick-one',
    mutating: true,
    detects: [],
    credentials: { kind: 'none' },
    analysisMode: 'static',
    install: { kind: 'npm-prefix', spec: 'x', pin: '1.0.0', binName: 'x' },
    invoke: { argv: ['{skillDir}', '{toolDir}'], cwd: 'repoRoot' },
    versionArgv: ['--version'],
    artefacts: ['findings.sarif'],
    timeoutMs: 30_000,
  },
  parse: () => ({ outcome: 'passed', findings: [], metrics: {}, summary: 'rewrote' }),
})

/**
 * `optimise` ships no catalogued adapter (plan-m5.md's deliberate deferral), so
 * `buildProgram`'s `run` subcommand has no way to select a mutating tool for it
 * — the registry is a hard-coded map with no CLI-reachable seam. `runPipeline`
 * is what that subcommand's action itself calls with no transformation of its
 * own; driving it directly here, with a fake adapter injected the same way
 * `tests/core/pipeline-sandbox.test.ts` does for exactly this reason, is the
 * closest a case naming `optimise` can get to "through the product" until a
 * real optimise tool is catalogued.
 */
function runFiveKindPipeline(skill: SkillRef, toolBin: string) {
  const adapter = fiveKindAdapter()
  const ledger = openLedger(':memory:')
  const handle = runPipeline({
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
          bin: toolBin,
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
    authorised: true,
    executorFactory: () =>
      new AdapterStageExecutor('optimise', {
        lookup: (id) => (id === 'fake-optimiser' ? adapter : undefined),
      }),
  })
  // `runPipeline` never closes the ledger it is handed — the caller owns that
  // lifetime everywhere else in this suite — and this ledger has no other
  // owner, so it is closed here once the run (whichever way it ends) settles.
  handle.done.finally(() => ledger.close()).catch(() => undefined)
  return handle
}

const FIVE_KIND_FILES = {
  'sk/SKILL.md': SKILL_MD_FULL('sk'),
  'sk/old.txt': 'old\n',
  'sk/rename-me.txt': 'rename me\n',
  'sk/exec.sh': '#!/bin/sh\necho hi\n',
  // Plain text at rest, so both strategies start from a text baseline and the
  // tool's rewrite is what turns the *change*, not the file, binary.
  'sk/bin.dat': 'plain text for now\n',
}

async function fiveKindSkill(git: boolean): Promise<{ repo: string; skill: SkillRef }> {
  let repo: string
  if (git) {
    repo = await makeGitRepo({ files: FIVE_KIND_FILES })
    await chmod(join(repo, 'sk/exec.sh'), 0o755)
    await execFileP('git', ['commit', '-qam', 'exec.sh executable'], { cwd: repo })
  } else {
    repo = await makeRepo({ files: FIVE_KIND_FILES })
    await chmod(join(repo, 'sk/exec.sh'), 0o755)
  }
  const [skill] = await discoverSkills({ id: 'repo', path: repo, name: 'repo', isGit: git })
  return { repo, skill: skill as SkillRef }
}

describe('M5 exit criteria', () => {
  it.each([
    ['git-worktree', true],
    ['snapshot', false],
  ] as const)('%s applies and rolls back all five change kinds, binary included', async (_name, git) => {
    // ---- apply: all five land, through a real optimise run ----
    const { repo, skill } = await fiveKindSkill(git)
    const tool = await makeFiveKindTool()
    const applyHandle = runFiveKindPipeline(skill, tool)

    let pendingScope: string[] = []
    let pendingDiff = ''
    const drain = (async () => {
      for await (const event of applyHandle.events) {
        if (event.type === 'mutation:pending') {
          pendingScope = [...event.scope]
          pendingDiff = event.diff
          applyHandle.resolveMutation(event.requestId, 'apply')
        }
      }
    })()
    const applySummary = await applyHandle.done
    await drain

    expect(applySummary.outcome).toBe('passed')
    // One entry per path, and no duplicate path stands in for two kinds:
    // this is the change set's six entries (R10.8's five kinds, plus a binary
    // change on top of a `modified` one), observed through the pipeline's own
    // event stream rather than by reaching into the sandbox directly.
    expect(pendingScope.sort()).toEqual(
      ['sk/SKILL.md', 'sk/added.txt', 'sk/bin.dat', 'sk/exec.sh', 'sk/old.txt', 'sk/renamed.txt'].sort(),
    )
    // The one signal the CLI's own event stream carries that bin.dat was
    // actually classified binary, as opposed to merely written — and the two
    // strategies diverge in what that signal looks like. `git diff --binary`
    // embeds a binary patch (still not a *text* diff of the bytes); the
    // snapshot strategy's own `changeSet()` excludes a binary entry from
    // `unifiedDiff` altogether (R10.8: it "stays in entries", not in the
    // diff). Either way, a text-diffed bin.dat — the failure this guards
    // against — would look nothing like what is asserted here.
    if (git) {
      expect(pendingDiff).toContain('GIT binary patch')
    } else {
      expect(pendingDiff).not.toContain('bin.dat')
    }
    expect(pendingDiff).toContain('1.1.0')

    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk', '1.1.0'))
    expect(await readFile(join(repo, 'sk/added.txt'), 'utf8')).toBe('added by the optimiser\n')
    await expect(stat(join(repo, 'sk/old.txt'))).rejects.toThrow()
    expect(await readFile(join(repo, 'sk/renamed.txt'), 'utf8')).toBe('rename me\n')
    expect((await stat(join(repo, 'sk/exec.sh'))).mode & 0o111).toBe(0)
    // The binary write landed byte-for-byte, not merely "some bytes changed":
    // a Buffer comparison, not `utf8`, since these bytes are not valid UTF-8.
    expect(await readFile(join(repo, 'sk/bin.dat'))).toEqual(BINARY_BYTES)

    // ---- rollback: a fresh, identical fixture discards to the same bytes ----
    const fresh = await fiveKindSkill(git)
    const before = await treeDigest(fresh.repo)
    const discardHandle = runFiveKindPipeline(fresh.skill, tool)
    const discardDrain = (async () => {
      for await (const event of discardHandle.events) {
        if (event.type === 'mutation:pending') discardHandle.resolveMutation(event.requestId, 'discard')
      }
    })()
    const discardSummary = await discardHandle.done
    await discardDrain
    expect(discardSummary.stages[0]?.outcome).toBe('skipped')
    expect(await treeDigest(fresh.repo)).toEqual(before)
  }, 30_000)

  it('recovers a crash during the mutating tool', async () => {
    const h = await cliHome()
    const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
    await registerRepo(h.home, repo)
    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    const recordDir = join((skill as SkillRef).workspacePath, 'skillgantry', 'runs', 'crash-1')

    // A second process, because an in-process test cannot leave the sandbox
    // marker `active` behind — the very thing recovery is meant to find.
    await runInChild(`
import { writeFile } from 'node:fs/promises'
import { openSandbox } from '${CORE}/isolation/open.js'
const skill = ${JSON.stringify(skill)}
const sandbox = await openSandbox({
  skill,
  stage: 'optimise',
  runId: 'crash-1',
  recordDir: ${JSON.stringify(recordDir)},
  scope: ['sk/SKILL.md'],
})
await writeFile(sandbox.resolve('sk/SKILL.md'), 'half-written by a crashed tool\\n')
process.stdout.write('wrote\\n')
process.exit(0)
`)

    // The snapshot strategy points the tool at the live tree, so the crash
    // leaves it half-written with no journal — the marker is the only trace.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written by a crashed tool\n')

    h.out.length = 0
    await h.exec(['recover', '--json'])
    const found = JSON.parse(h.out.at(-1) as string) as Array<{
      record: { runId: string; strategy: string }
      skillId: string
    }>
    expect(found).toHaveLength(1)
    expect(found[0]?.record.strategy).toBe('snapshot')
    expect(found[0]?.skillId).toBe((skill as SkillRef).id)

    await h.exec(['recover', '--restore', found[0]?.record.runId as string])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))

    h.out.length = 0
    await h.exec(['recover', '--json'])
    expect(JSON.parse(h.out.at(-1) as string)).toEqual([])
  }, 60_000)

  it('recovers a crash while awaiting approval', async () => {
    const h = await cliHome()
    const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
    await registerRepo(h.home, repo)
    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    const tool = await makeFiveKindTool()

    // Killed the instant the diff is on record (`mutation:pending`), before a
    // resolution reaches the gate — R5.13/R10.10's window, proved by a second
    // process rather than a fabricated record.
    await runInChild(`
import { runPipeline } from '${CORE}/pipeline/run.js'
import { AdapterStageExecutor } from '${CORE}/stages/adapter-stage.js'
import { openLedger } from '${CORE}/ledger/db.js'
const skill = ${JSON.stringify(skill)}
const adapter = {
  manifest: {
    id: 'fake-optimiser', stage: 'optimise', policy: 'pick-one', mutating: true,
    detects: [], credentials: { kind: 'none' }, analysisMode: 'static',
    install: { kind: 'npm-prefix', spec: 'x', pin: '1.0.0', binName: 'x' },
    invoke: { argv: ['{skillDir}', '{toolDir}'], cwd: 'repoRoot' },
    versionArgv: ['--version'], artefacts: ['findings.sarif'], timeoutMs: 30000,
  },
  parse: () => ({ outcome: 'passed', findings: [], metrics: {}, summary: 'rewrote' }),
}
const ledger = openLedger(':memory:')
const handle = runPipeline({
  skill, stages: ['optimise'], trigger: 'test', stageTools: { optimise: ['fake-optimiser'] },
  lock: { version: 1, tools: { 'fake-optimiser': {
    installKind: 'npm-prefix', requestedPin: '1.0.0', resolvedVersion: '1.0.0',
    bin: ${JSON.stringify(tool)}, integrity: 'n/a', installedAt: 'now', verifiedAt: 'now',
  } } },
  ledger, env: process.env, secrets: [], provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
  artefactSizeCapBytes: 1000000, timeoutOverridesMs: {}, authorised: true,
  executorFactory: () => new AdapterStageExecutor('optimise', { lookup: (id) => id === 'fake-optimiser' ? adapter : undefined }),
})
for await (const event of handle.events) {
  if (event.type === 'mutation:pending') {
    process.stdout.write('pending\\n')
    process.exit(0)
  }
}
`)

    // The tool had already written before the diff was shown, so the live
    // tree reflects it — this is what makes the case distinct from a crash
    // with no sandbox open at all.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk', '1.1.0'))

    h.out.length = 0
    await h.exec(['recover', '--json'])
    const found = JSON.parse(h.out.at(-1) as string) as Array<{ record: { runId: string } }>
    expect(found).toHaveLength(1)

    await h.exec(['recover', '--restore', found[0]?.record.runId as string])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))

    h.out.length = 0
    await h.exec(['recover', '--json'])
    expect(JSON.parse(h.out.at(-1) as string)).toEqual([])
  }, 60_000)

  it('refuses a dirty skill and seeds the override correctly', async () => {
    const h = await cliHome()
    const repo = await makeGitRepo({
      files: {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    })
    await registerRepo(h.home, repo)
    const skillsBin = await fakeSkillsBin(0)
    await saveToolLock(h.home, { version: 1, tools: { skills: skillsLockEntry(skillsBin) } })

    // Dirty SKILL.md without committing: a hand edit sitting on top of the
    // one the gates ran against.
    const dirty = SKILL_MD_FULL('sk', '1.0.0', 'edited before release, uncommitted')
    await writeFile(join(repo, 'sk/SKILL.md'), dirty)

    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

    // Without --allow-dirty: refused, naming the dirty path.
    h.out.length = 0
    const codeWithoutOverride = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    expect(codeWithoutOverride).toBe(1)
    expect(h.out.some((l) => l.includes('sandbox:') && l.includes('sk/SKILL.md'))).toBe(true)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(dirty)

    // With --allow-dirty: the tool reads the user's own uncommitted bytes —
    // the released SKILL.md carries both the hand edit and the version bump.
    h.out.length = 0
    const codeWithOverride = await h.exec([
      'release',
      'sk',
      '--version',
      'minor',
      '--yes',
      '--allow-dirty',
    ])
    expect(codeWithOverride).toBe(0)
    const released = await readFile(join(repo, 'sk/SKILL.md'), 'utf8')
    expect(released).toContain('edited before release, uncommitted')
    expect(released).toContain('1.1.0')
  }, 30_000)

  it('aborts the apply when a target drifts between preview and approval', async () => {
    const h = await cliHome()
    const repo = await makeGitRepo({
      files: {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    })
    await registerRepo(h.home, repo)
    const skillsBin = await fakeSkillsBin(0)
    await saveToolLock(h.home, { version: 1, tools: { skills: skillsLockEntry(skillsBin) } })

    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

    // Drives the CLI's own `--yes` auto-resolve loop, and hijacks its `write`
    // seam to land a hand edit on the live tree the instant the diff is
    // printed — synchronously, before `runRelease`'s next line resolves the
    // gate. The actual apply happens later, off this call stack, so the
    // edit is reliably in place before the preimage recheck runs.
    const armed = { fired: false }
    const program = buildProgram({
      home: h.home,
      dbPath: h.dbPath,
      write: (line) => {
        h.out.push(line)
        if (!armed.fired && line.startsWith('changes to')) {
          armed.fired = true
          writeFileSync(join(repo, 'sk/SKILL.md'), 'hand-edited between preview and approval\n')
        }
      },
    })
    await program.exitOverride().parseAsync([
      'node',
      'skillgantry',
      'release',
      'sk',
      '--version',
      'minor',
      '--yes',
    ])

    expect(program.exitCode).toBe(1)
    expect(armed.fired).toBe(true)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(
      'hand-edited between preview and approval\n',
    )

    // R5.13: the run still finalised, so this row exists at all.
    expect(latestReleaseToolRun(h.dbPath)).toMatchObject({
      errorKind: 'mutation-aborted',
      outcome: 'errored',
    })
  }, 30_000)

  it('blocks a release whose gates passed against different bytes', async () => {
    const h = await cliHome()
    // A non-git repo: R10.3's dirty guard is a git concept, and this case is
    // about R9.9 specifically, not about entangling it with an uncommitted-tree
    // refusal that would fire first in a git repo.
    const repo = await makeRepo({
      files: {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    })
    await registerRepo(h.home, repo)
    const skillsBin = await fakeSkillsBin(0)
    await saveToolLock(h.home, { version: 1, tools: { skills: skillsLockEntry(skillsBin) } })

    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

    // Edited after the gates ran: the candidate's digest now disagrees.
    await writeFile(
      join(repo, 'sk/SKILL.md'),
      SKILL_MD_FULL('sk', '1.0.0', 'edited after the gates passed'),
    )

    h.out.length = 0
    const code = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    expect(code).toBe(1)
    expect(h.out.some((l) => l.includes('R9.9'))).toBe(true)
    // Nothing written: still the un-bumped, edited SKILL.md.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('edited after the gates passed')
    await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
  })

  it('releases a repo with no versions.json and records the mode', async () => {
    const h = await cliHome()
    const repo = await makeGitRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
    await registerRepo(h.home, repo)
    const skillsBin = await fakeSkillsBin(0)
    await saveToolLock(h.home, { version: 1, tools: { skills: skillsLockEntry(skillsBin) } })

    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

    const code = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    expect(code).toBe(0)

    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    expect(await readFile(join(repo, 'sk/CHANGELOG.md'), 'utf8')).toContain('1.1.0')
    // R9.1: SkillGantry never creates a versions.json where none existed.
    await expect(stat(join(repo, 'versions.json'))).rejects.toThrow()
    // The positive control the three "leaves no archive" cases need: this is
    // the one case that actually releases end to end, so the archive really
    // has to exist here, or `.rejects.toThrow()` elsewhere would be trivially
    // true for a tool that never wrote one at all.
    expect((await stat(join(repo, 'sk_1.1.0.zip'))).size).toBeGreaterThan(0)

    const runDir = await runDirOf((skill as SkillRef).workspacePath)
    const evidence = JSON.parse(await readFile(join(runDir, 'evidence', 'release.json'), 'utf8')) as {
      manifestMode: string
    }
    expect(evidence.manifestMode).toBe('none')
  })

  it('still lands the archive in a repo whose .gitignore excludes zips', async () => {
    // R9.4 end to end against the common `*.zip` convention. The archive rides
    // the change set by sitting in the sandbox at its eventual path, and
    // `git add -A` honours `.gitignore`, so without a forced stage the archive
    // was dropped from the diff and the journal while the evidence bundle still
    // recorded its SHA-256 and the stage still reported `passed`.
    const h = await cliHome()
    const repo = await makeGitRepo({
      files: { 'sk/SKILL.md': SKILL_MD_FULL('sk'), '.gitignore': '*.zip\n' },
    })
    await registerRepo(h.home, repo)
    await saveToolLock(h.home, {
      version: 1,
      tools: { skills: skillsLockEntry(await fakeSkillsBin(0)) },
    })

    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

    h.out.length = 0
    const code = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    expect(code).toBe(0)
    expect((await stat(join(repo, 'sk_1.1.0.zip'))).size).toBeGreaterThan(0)
    // The diff the user approved named it, rather than promising a file the
    // apply would never write.
    expect(h.out.join('\n')).toContain('sk_1.1.0.zip')
  }, 30_000)

  it('leaves no repo-root archive and no live change when packaging fails', async () => {
    const h = await cliHome()
    const repo = await makeGitRepo({
      files: {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    })
    await registerRepo(h.home, repo)
    const skillsBin = await fakeSkillsBin(0)
    await saveToolLock(h.home, { version: 1, tools: { skills: skillsLockEntry(skillsBin) } })

    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

    // `zip --version` still answers (so the mutation preflight and the
    // sandbox open), but the real archive call gets nothing but a nonzero
    // exit — the packaging step itself failing, not `zip`'s absence.
    const shimDir = await mkdtemp(join(tmpdir(), 'sg-m5-zip-'))
    await writeFile(
      join(shimDir, 'zip'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Zip 3.0"; exit 0; fi\nexit 1\n',
    )
    await chmod(join(shimDir, 'zip'), 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${shimDir}:${originalPath}`
    let code: number
    try {
      code = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    } finally {
      process.env.PATH = originalPath
    }

    expect(code).toBe(1)
    // A plain nonzero exit from a binary that did spawn is `mutation-aborted`
    // (`classifyExecError`'s fallback), not `spawn` — that classification is
    // reserved for the binary itself failing to spawn (ENOENT). The brief's
    // shorthand "errors with spawn" is read here as "the stage errors",
    // verified against the actual, documented classification.
    expect(latestReleaseToolRun(h.dbPath)).toMatchObject({
      errorKind: 'mutation-aborted',
      outcome: 'errored',
    })

    await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
    await expect(stat(join(repo, 'sk/CHANGELOG.md'))).rejects.toThrow()
  }, 30_000)

  it('leaves no repo-root archive and no live change when the installability gate fails', async () => {
    const h = await cliHome()
    const repo = await makeGitRepo({
      files: {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    })
    await registerRepo(h.home, repo)
    // The real vercel `skills` binary is not part of this offline suite (see
    // plan-m5.md and tests/core/release-stage.test.ts): the lock points at a
    // shim answering exactly like 1.5.21 does on a refusal, per the probed
    // facts. This case stays faked in every mode, `pnpm test:integration`
    // included — the describe block below is the one that gates on
    // `SG_INTEGRATION` and checks the genuine binary actually refuses the
    // way this shim assumes.
    const skillsBin = await fakeSkillsBin(1)
    await saveToolLock(h.home, { version: 1, tools: { skills: skillsLockEntry(skillsBin) } })

    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

    const code = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    expect(code).toBe(1)

    // The tool ran and refused on its own terms — `failed` (row 4), not
    // `errored`: this is what distinguishes it from the packaging case above.
    expect(latestReleaseToolRun(h.dbPath)).toMatchObject({ errorKind: null, outcome: 'failed' })
    const stageJson = JSON.parse(
      await readFile(join(await runDirOf((skill as SkillRef).workspacePath), '05-release/stage.json'), 'utf8'),
    ) as { toolRuns: Array<{ summary: string }> }
    expect(stageJson.toolRuns[0]?.summary).toContain('No valid skills found')

    await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
    await expect(stat(join(repo, 'sk/CHANGELOG.md'))).rejects.toThrow()
  })

  it('runs the gates against a deprecated skill and refuses to release it', async () => {
    const h = await cliHome()
    // Non-git: retirement's own write would otherwise leave the tree dirty
    // for release's later sandbox-open, entangling R10.3 with R1.4, which is
    // not what this case is about.
    const repo = await makeRepo({
      files: {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    })
    await registerRepo(h.home, repo)
    const skillsBin = await fakeSkillsBin(0)
    const lintBin = await makeFakeTool(
      'skill-lint',
      'echo \'{"schemaVersion":1,"skill":{"files":[]},"findings":[]}\'',
    )
    await saveToolLock(h.home, {
      version: 1,
      tools: { skills: skillsLockEntry(skillsBin), 'skill-lint': lintLockEntry(lintBin) },
    })
    await saveConfig(h.home, {
      ...DEFAULT_CONFIG,
      repos: (await loadConfig(h.home)).repos,
      stageTools: { validate: ['skill-lint'], evaluate: [], security: [], optimise: [] },
    })

    const retireCode = await h.exec(['retire', 'sk', '--yes'])
    expect(retireCode).toBe(0)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toMatch(/deprecated/)

    // Gates still run against a deprecated skill (R1.4): validate passes.
    h.out.length = 0
    const validateCode = await h.exec(['run', 'sk', '--stage', 'validate', '--json'])
    expect(validateCode).toBe(0)

    const releaseCode = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    expect(releaseCode).toBe(1)

    const config2 = await loadConfig(h.home)
    const [skill] = await discoverSkills(config2.repos[0] as (typeof config2.repos)[number])
    const stageJson = JSON.parse(
      await readFile(join(await runDirOf((skill as SkillRef).workspacePath), '05-release/stage.json'), 'utf8'),
    ) as { toolRuns: Array<{ summary: string }> }
    expect(stageJson.toolRuns[0]?.summary).toContain('deprecated')
  })

  it('records a release in the ledger and closes no issue', async () => {
    const h = await cliHome()
    const repo = await makeGitRepo({
      files: {
        'sk/SKILL.md': SKILL_MD_FULL('sk'),
        'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
      },
    })
    await registerRepo(h.home, repo)
    const skillsBin = await fakeSkillsBin(0)
    // LOW, not MEDIUM: a finding below the fail floor still files an issue
    // (design §8.1 row 12b) while letting validate itself pass, which is what
    // makes release's own gate check reachable at all.
    const lintBin = await makeFakeTool(
      'skill-lint',
      'echo \'{"schemaVersion":1,"skill":{"files":[]},"findings":[{"ruleId":"R06","severity":"LOW","file":"SKILL.md","message":"unsafe pattern"}]}\'\nexit 0\n',
    )
    await saveToolLock(h.home, {
      version: 1,
      tools: { skills: skillsLockEntry(skillsBin), 'skill-lint': lintLockEntry(lintBin) },
    })
    await saveConfig(h.home, {
      ...DEFAULT_CONFIG,
      repos: (await loadConfig(h.home)).repos,
      stageTools: { validate: ['skill-lint'], evaluate: [], security: [], optimise: [] },
    })

    const validateCode = await h.exec(['run', 'sk', '--stage', 'validate', '--json'])
    expect(validateCode).toBe(0) // below the fail floor: validate passes, the finding is still filed

    const ledger = openLedger(h.dbPath)
    let skillId: string
    let issueFingerprint: string
    let digestAtValidate: string
    try {
      const skillRow = ledger.db.prepare('select id from skills limit 1').get() as { id: string }
      skillId = skillRow.id
      const issueRow = ledger.db
        .prepare('select fingerprint, state from issues where skill_id = ?')
        .get(skillId) as { fingerprint: string; state: string }
      expect(issueRow.state).toBe('open')
      issueFingerprint = issueRow.fingerprint
      const runRow = ledger.db
        .prepare('select skill_digest as digest from runs order by rowid desc limit 1')
        .get() as { digest: string }
      digestAtValidate = runRow.digest
    } finally {
      ledger.close()
    }

    // evaluate/security seeded to agree with validate's own recorded digest,
    // so release's precondition check is exercised without also re-deriving
    // the digest computation this case is not about.
    const ledger2 = openLedger(h.dbPath)
    const config = await loadConfig(h.home)
    const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
    recordRun(ledger2, {
      skill: skill as SkillRef,
      runId: 'gates-eval-sec',
      trigger: 'test',
      startedAt: '2026-08-02T00:00:00Z',
      endedAt: '2026-08-02T00:01:00Z',
      outcome: 'passed',
      skillDigest: digestAtValidate,
      git: { commit: null, dirty: false },
      provenanceJson: '{}',
      toolLockJson: '{}',
      sidecarPath: join((skill as SkillRef).workspacePath, 'skillgantry', 'runs', 'gates-eval-sec'),
      stages: (['evaluate', 'security'] as Stage[]).map((stage) => ({
        stage,
        outcome: 'passed' as const,
        verdict: 'passed' as const,
        toolRuns: [],
      })),
    })
    ledger2.close()

    const headBefore = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout
    const releaseCode = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
    expect(releaseCode).toBe(0)
    // R9.7: applying never creates a commit. The release wrote real,
    // uncommitted bytes above (SKILL.md, versions.json, the archive) — HEAD
    // not moving is what proves apply stopped at the working tree.
    expect((await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout).toBe(headBefore)

    const ledger3 = openLedger(h.dbPath)
    try {
      // `skills` is a catalogued tool with no adapter (design §5.1a): its run
      // is recorded, but it reconciles nothing, so the issue skill-lint filed
      // stays open even though a release just happened.
      const releaseRun = ledger3.db
        .prepare(
          `select tr.tool_id as toolId, tr.outcome as outcome
           from tool_runs tr
           join stages s on s.id = tr.stage_id
           join runs r on r.id = s.run_id
           where s.stage = 'release'
           order by r.rowid desc limit 1`,
        )
        .get() as { toolId: string; outcome: string } | undefined
      expect(releaseRun).toMatchObject({ toolId: 'skills', outcome: 'passed' })

      const issue = ledger3.db
        .prepare('select state from issues where fingerprint = ?')
        .get(issueFingerprint) as { state: string }
      expect(issue.state).toBe('open')
    } finally {
      ledger3.close()
    }
  })
})

// The only M5 acceptance case reaching the network: it installs the genuine
// vercel `skills` 1.5.21 and checks it refuses the way case 9 above's shim
// assumes it does, for a real reason (a missing `description`, plan-m5.md's
// own known gap) rather than an exit code the shim was simply told to return.
// Case 9 itself stays faked in every mode — this is what keeps that fake
// honest, the same way `tests/acceptance/m1.test.ts`'s exit criterion 8 does
// for skillspector.
describe.skipIf(!process.env.SG_INTEGRATION)(
  'the installability gate against the genuine vercel `skills` binary',
  () => {
    it('refuses a skill with no description, for real', async () => {
      const h = await cliHome()
      const repo = await makeGitRepo({
        files: {
          // `SKILL_MD`, not `SKILL_MD_FULL`: no `description`, which is the one
          // documented, real reason vercel `skills` refuses to install a
          // candidate (plan-m5.md's "Known gaps").
          'sk/SKILL.md': SKILL_MD('sk'),
          'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
        },
      })
      await registerRepo(h.home, repo)

      const spec = catalogueEntry(RELEASE_TOOL_ID)
      if (!spec) throw new Error('the release tool dropped out of the catalogue')
      await installTool(h.home, spec)

      const config = await loadConfig(h.home)
      const [skill] = await discoverSkills(config.repos[0] as (typeof config.repos)[number])
      await seedGatesForCurrentBytes(h.dbPath, skill as SkillRef)

      const code = await h.exec(['release', 'sk', '--version', 'minor', '--yes'])
      expect(code).toBe(1)

      // The genuine binary refuses on its own terms too — `failed`, not
      // `errored` — which is the one shape case 9's shim has to keep true.
      expect(latestReleaseToolRun(h.dbPath)).toMatchObject({ errorKind: null, outcome: 'failed' })
      await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
      expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).not.toContain('1.1.0')
    }, 180_000)
  },
)
