import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { loadToolLock, registerRepo, saveToolLock } from '../../src/core/config/config.js'
import { installAndLock } from '../../src/core/tools/install.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SECRET = 'sk-testtokenvalue000000000000000000'

const SARIF = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results }],
  })

const FINDING = {
  ruleId: 'LP3',
  message: { text: 'no declared permissions' },
  level: 'warning',
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'SKILL.md' }, region: { startLine: 1 } } },
  ],
}

interface Harness {
  home: string
  repoPath: string
  dbPath: string
  out: string[]
  exec(args: string[]): Promise<number>
}

const lockFor = (bin: string) =>
  ({
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
  }) as const

function execFor(home: string, dbPath: string, out: string[]) {
  return async (args: string[]): Promise<number> => {
    const program = buildProgram({ home, dbPath, write: (l) => out.push(l) })
    await program.exitOverride().parseAsync(['node', 'skillgantry', ...args])
    return program.exitCode ?? 0
  }
}

async function harness(script: string, opts: { withEnv?: boolean } = {}): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({
    files: {
      'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
      'declawed/scripts/scan.py': 'print("hi")\n',
    },
  })
  await registerRepo(home, repoPath)

  if (opts.withEnv) {
    await writeFile(join(home, '.env'), `ANTHROPIC_AUTH_TOKEN=${SECRET}\n`, { mode: 0o600 })
  }

  const bin = await makeFakeTool('skillspector', script)
  await saveToolLock(home, lockFor(bin))

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return { home, repoPath, dbPath, out, exec: execFor(home, dbPath, out) }
}

const runDirOf = async (repoPath: string, workspace = 'declawed-workspace'): Promise<string> => {
  const runs = join(repoPath, `${workspace}/skillgantry/runs`)
  const entries = await readdir(runs, { withFileTypes: true })
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  return join(runs, dirs.at(-1) as string)
}

const runDigest = async (h: Harness): Promise<string> =>
  JSON.parse(await readFile(join(await runDirOf(h.repoPath), 'run.json'), 'utf8')).skillDigest

/** A single-skill repo, so its workspace lands inside the tree tools are given. */
async function rootSkillHarness(script: string): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({ files: { 'SKILL.md': SKILL_MD('solo', '1.0.0') } })
  await registerRepo(home, repoPath)

  const bin = await makeFakeTool('skillspector', script)
  await saveToolLock(home, lockFor(bin))

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return { home, repoPath, dbPath, out, exec: execFor(home, dbPath, out) }
}

/** Path of the `.seen` listing the canary fixture tool wrote beside its report. */
const latestSeenFile = async (h: Harness): Promise<string> =>
  join(
    await runDirOf(h.repoPath, '.skillgantry-workspace'),
    '03-security/skillspector/findings.sarif.seen',
  )

/** Like `harness`, but installs the real SkillSpector through the tool root. */
async function harnessWithManagedTool(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({
    files: {
      'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
      'declawed/scripts/scan.py': 'print("hi")\n',
    },
  })
  await registerRepo(home, repoPath)
  await installAndLock(
    home,
    {
      id: 'skillspector',
      kind: 'uv-tool',
      spec: 'git+https://github.com/NVIDIA/skillspector.git',
      pin: 'v2.5.1',
      binName: 'skillspector',
    },
    ['--version'],
  )

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return { home, repoPath, dbPath, out, exec: execFor(home, dbPath, out) }
}

async function walkFiles(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walkFiles(path, acc)
    else if (entry.isFile()) acc.push(path)
  }
  return acc
}

describe('M1 exit criterion 1: a headless security run writes evidence and populates the ledger', () => {
  it('produces a complete run directory and ledger rows', async () => {
    const h = await harness(`printf '%s' '${SARIF([FINDING])}' > "$7"`)
    const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect(code).toBe(1) // findings present, so the gate is red

    const runDir = await runDirOf(h.repoPath)
    // R6.1: the directory is the run's start time, and the run id lives in
    // run.json — the two together are what makes a run identifiable by `ls`.
    expect(basename(runDir)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/)
    const meta = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'))
    expect(meta.runId).toMatch(/^[0-9a-f-]{36}$/)

    const files = (await walkFiles(runDir)).map((f) => f.replace(`${runDir}/`, ''))
    expect(files).toContain('run.json')
    expect(files).toContain('03-security/stage.json')
    expect(files).toContain('03-security/skillspector/stdout.log')
    expect(files).toContain('03-security/skillspector/findings.sarif')

    const ledger = openLedger(h.dbPath)
    const counts = (table: string): number =>
      (ledger.db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
    expect(counts('runs')).toBe(1)
    expect(counts('stages')).toBe(1)
    expect(counts('tool_runs')).toBe(1)
    expect(counts('issues')).toBe(1)
    expect(counts('issue_detections')).toBe(1)
    ledger.close()

    const index = await readFile(
      join(h.repoPath, 'declawed-workspace/skillgantry/runs/index.ndjson'),
      'utf8',
    )
    expect(index.trim().split('\n')).toHaveLength(1)
  })
})

describe('M1 exit criterion 2: a whitespace-only edit changes no fingerprint', () => {
  it('keeps the same issue rather than opening a new one', async () => {
    const h = await harness(`printf '%s' '${SARIF([FINDING])}' > "$7"`)
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const ledger = openLedger(h.dbPath)
    const before = ledger.db.prepare('select fingerprint from issues').all()
    ledger.close()

    const skillMd = join(h.repoPath, 'declawed/SKILL.md')
    await writeFile(skillMd, `${await readFile(skillMd, 'utf8')}\n\n\n`)
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const after = openLedger(h.dbPath)
    const fingerprints = after.db.prepare('select fingerprint, state from issues').all()
    expect(fingerprints).toHaveLength(before.length)
    expect(fingerprints[0]).toMatchObject({ state: 'open' })
    after.close()
  })
})

describe('M1 exit criterion 3: an errored tool closes no issue', () => {
  it('leaves the issue open when the second run crashes', async () => {
    const h = await harness(`printf '%s' '${SARIF([FINDING])}' > "$7"`)
    await h.exec(['run', 'declawed', '--stage', 'security'])

    // Replace the tool with one that writes nothing and exits non-zero.
    const broken = await makeFakeTool('skillspector', 'echo boom >&2; exit 2')
    await saveToolLock(h.home, lockFor(broken))
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const ledger = openLedger(h.dbPath)
    const states = ledger.db
      .prepare('select state from issues')
      .all()
      .map((r) => (r as { state: string }).state)
    expect(states).toEqual(['open'])
    const toolRuns = ledger.db.prepare('select outcome, error_kind from tool_runs order by id').all()
    expect(toolRuns.at(-1)).toMatchObject({ outcome: 'errored' })
    ledger.close()
  })
})

describe('M1 exit criterion 4: no secret reaches a log SkillGantry writes', () => {
  it('redacts streams and records that native artefacts are unredacted', async () => {
    const h = await harness(
      `printf 'TOKEN=%s\\n' "$ANTHROPIC_AUTH_TOKEN"; printf '%s' '${SARIF([])}' > "$7"`,
      { withEnv: true },
    )
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const runDir = await runDirOf(h.repoPath)
    const logs = (await walkFiles(runDir)).filter((f) => f.endsWith('.log'))
    expect(logs.length).toBeGreaterThan(0)
    for (const log of logs) {
      expect(await readFile(log, 'utf8')).not.toContain(SECRET)
    }

    // R7.5: provenance carries a hash, never the token.
    const runJson = await readFile(join(runDir, 'run.json'), 'utf8')
    expect(runJson).not.toContain(SECRET)
    expect(runJson).toMatch(/"authTokenHash": "sha256:[0-9a-f]{8}"/)

    // R7.4a: unredacted native artefacts are flagged rather than silently trusted.
    const stageJson = JSON.parse(await readFile(join(runDir, '03-security/stage.json'), 'utf8'))
    expect(stageJson.toolRuns[0].redacted).toBe(false)
  })
})

describe('M1 exit criterion 5: a hanging process tree is killed', () => {
  it('terminates the tool and reports a timeout', async () => {
    const h = await harness('sleep 600')
    // A one-second override keeps the test fast.
    const configPath = join(h.home, 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    config.timeoutOverridesMs = { skillspector: 1000 }
    await writeFile(configPath, JSON.stringify(config))

    const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect(code).toBe(1)

    const ledger = openLedger(h.dbPath)
    expect(ledger.db.prepare('select error_kind from tool_runs').get()).toMatchObject({
      error_kind: 'timeout',
    })
    ledger.close()
  })
})

describe('M1 exit criterion 6: a directory named snapshot-pre is part of the skill', () => {
  it('changes the digest, so gate evidence cannot survive an edit inside it', async () => {
    const h = await harness(`printf '%s' '${SARIF([])}' > "$7"`)
    const notes = join(h.repoPath, 'declawed/snapshot-pre/notes.md')
    await mkdir(dirname(notes), { recursive: true })
    await writeFile(notes, 'one\n')

    await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    const before = await runDigest(h)

    await writeFile(notes, 'two\n')
    await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect(await runDigest(h)).not.toBe(before)
  })
})

describe('M1 exit criterion 7: a repo-root skill never exposes its own workspace', () => {
  it('keeps a canary in a prior artefact out of the tool input', async () => {
    // The fixture tool copies whatever it can see under its scan target into
    // its report, which is the behaviour a model-assisted scanner would have.
    const h = await rootSkillHarness(
      'find "$2" -type f | tr "\\n" " " > "$7".seen; ' + `printf '%s' '${SARIF([])}' > "$7"`,
    )

    const workspace = join(h.repoPath, '.skillgantry-workspace')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'old-report.json'), 'CANARY-sk-000111222\n')

    await h.exec(['run', 'solo', '--stage', 'security', '--json'])

    const seen = await readFile(await latestSeenFile(h), 'utf8')
    expect(seen).not.toContain('.skillgantry-workspace')
    expect(seen).not.toContain('CANARY')
  })
})

// The only acceptance criterion that reaches the network, so it opts in with
// the install-driver suite rather than slowing every acceptance run.
describe.skipIf(!process.env.SG_INTEGRATION)(
  'M1 exit criterion 8: the managed tool root drives a real scan',
  () => {
    it('installs skillspector, locks it, and runs it against a real skill', async () => {
      const h = await harnessWithManagedTool()
      const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
      expect([0, 1]).toContain(code)

      const lock = await loadToolLock(h.home)
      expect(lock.tools.skillspector?.bin.startsWith(join(h.home, 'tools'))).toBe(true)
      expect(lock.tools.skillspector?.resolvedVersion).toBe('2.5.1')

      const ledger = openLedger(h.dbPath)
      expect(ledger.db.prepare('select tool_version from tool_runs').get()).toMatchObject({
        tool_version: '2.5.1',
      })
      ledger.close()
    }, 300_000)
  },
)
