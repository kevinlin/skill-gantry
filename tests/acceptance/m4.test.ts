import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import {
  DEFAULT_CONFIG,
  loadConfig,
  registerRepo,
  saveConfig,
  saveToolLock,
} from '../../src/core/config/config.js'
import { listAdapters } from '../../src/core/adapters/registry.js'
import { RULE_CLASS_MAP_VERSION } from '../../src/core/adapters/rule-classes.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import { migrateRuleMap } from '../../src/core/ledger/rule-map-migration.js'
import { recordRun } from '../../src/core/ledger/record.js'
import type { StageResult, ToolRunRecord } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

/**
 * R4.3's seal. An ESM namespace cannot be reassigned or spied, so the modules a
 * parser must never reach are mocked at load time and throw only while `on` is
 * set — otherwise the harness, which legitimately spawns and writes, could not
 * share this file.
 */
const seal = vi.hoisted(() => ({ on: false }))

function sealed<T extends object>(real: T, name: string): T {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]): unknown => {
        if (seal.on) throw new Error(`a parser called ${name}.${String(prop)}`)
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  })
}

vi.mock('node:fs', async (importOriginal) =>
  sealed(await importOriginal<typeof import('node:fs')>(), 'node:fs'),
)
vi.mock('node:child_process', async (importOriginal) =>
  sealed(await importOriginal<typeof import('node:child_process')>(), 'node:child_process'),
)
vi.mock('node:net', async (importOriginal) =>
  sealed(await importOriginal<typeof import('node:net')>(), 'node:net'),
)

const SKILL = 'architecture-diagram'
const MERGED = `${SKILL}/scripts/html_to_png.py`
const LINT_ONLY = `${SKILL}/scripts/build_gallery.py`

const lockEntry = (bin: string, version: string) => ({
  installKind: 'uv-tool' as const,
  requestedPin: `v${version}`,
  resolvedVersion: version,
  bin,
  integrity: 'n/a',
  installedAt: '2026-08-01T00:00:00Z',
  verifiedAt: '2026-08-01T00:00:00Z',
})

interface Harness {
  home: string
  repoPath: string
  dbPath: string
  out: string[]
  exec(args: string[]): Promise<number>
}

/**
 * Real fixture bytes, emitted by shell shims standing in for the two tools, so
 * the whole path runs: manifest argv, artefact collection, the real parsers, the
 * real sidecar writer and the real ledger. Only the subprocess is fake.
 */
async function harness(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'sg-m4-home-'))
  const repoPath = await makeRepo({
    files: {
      [`${SKILL}/SKILL.md`]: SKILL_MD(SKILL, '1.0.0'),
      [`${SKILL}/scripts/html_to_png.py`]: 'print("hi")\n',
      [`${SKILL}/scripts/build_gallery.py`]: 'print("hi")\n',
    },
  })
  await registerRepo(home, repoPath)

  const sarif = join(process.cwd(), 'tests/fixtures/sarif/skillspector-architecture-diagram.sarif')
  const scannerSarif = join(
    process.cwd(),
    'tests/fixtures/sarif/skill-scanner-insight-profile.sarif',
  )
  const lintJson = join(process.cwd(), 'tests/fixtures/skill-lint/architecture-diagram.json')

  // Each manifest ends `--output {toolDir}/findings.sarif`, at a different argv
  // position: $7 for skillspector, $8 for skill-scanner. skill-lint declares no
  // artefact and reports on stdout.
  const spectorBin = await makeFakeTool('skillspector', `cp ${sarif} "$7"; exit 1`)
  const scannerBin = await makeFakeTool('skill-scanner', `cp ${scannerSarif} "$8"; exit 1`)
  const lintBin = await makeFakeTool('skill-lint', `cat ${lintJson}; exit 2`)

  await saveToolLock(home, {
    version: 1,
    tools: {
      skillspector: lockEntry(spectorBin, '2.5.1'),
      'skill-lint': lockEntry(lintBin, '0.2.0'),
      'skill-scanner': lockEntry(scannerBin, '0.3.3'),
    },
  })
  // skill-scanner declares a one-of credential requirement, so without these it
  // would be skipped rather than run. Placeholders: the shim reads neither.
  await writeFile(join(home, '.env'), 'SKILLSCAN_API_KEY=placeholder\nSKILLSCAN_MODEL=fixture\n', {
    mode: 0o600,
  })

  const config = await loadConfig(home)
  await saveConfig(home, {
    ...DEFAULT_CONFIG,
    repos: config.repos,
    stageTools: { validate: ['skill-lint'], evaluate: [], security: ['skillspector'], optimise: [] },
  })

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  return {
    home,
    repoPath,
    dbPath,
    out,
    exec: async (args) => {
      const program = buildProgram({ home, dbPath, write: (l) => out.push(l) })
      await program.exitOverride().parseAsync(['node', 'skillgantry', ...args])
      return program.exitCode ?? 0
    },
  }
}

const runDirOf = async (repoPath: string): Promise<string> => {
  const runs = join(repoPath, `${SKILL}-workspace/skillgantry/runs`)
  const dirs = (await readdir(runs, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  return join(runs, dirs.at(-1) as string)
}

// ---- ledger-level helpers, for the closure and migration criteria ----

const skillRef: SkillRef = {
  id: `zapac/${SKILL}`,
  name: SKILL,
  version: null,
  dir: `/tmp/zapac/${SKILL}`,
  relPath: SKILL,
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: `/tmp/zapac/${SKILL}-workspace`,
}

const finding = (ruleClass: string, path: string, nativeRuleId: string): RawFinding => ({
  ruleClass: ruleClass as RawFinding['ruleClass'],
  nativeRuleId,
  severity: 'medium',
  path,
  message: nativeRuleId,
})

const toolRun = (
  toolId: string,
  findings: RawFinding[],
  outcome: ToolRunRecord['outcome'] = 'failed',
): ToolRunRecord => ({
  toolId,
  toolVersion: '1.0.0',
  outcome,
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: `/tmp/ws/${toolId}`,
  findings,
  metrics: {},
  summary: '',
})

const runInput = (runId: string, stages: StageResult[]) => ({
  skill: skillRef,
  runId,
  trigger: 'test',
  startedAt: '2026-08-02T00:00:00Z',
  endedAt: '2026-08-02T00:01:00Z',
  outcome: 'failed' as const,
  skillDigest: 'sha256:x',
  git: { commit: null, dirty: false },
  provenanceJson: '{}',
  toolLockJson: '{}',
  sidecarPath: '/tmp/ws',
  stages,
})

describe('M4 exit criteria', () => {
  it('two tools reporting one class in one file produce one issue with two detections', async () => {
    const h = await harness()
    // Two single-stage runs, not one chained run: each stage is exercised on its
    // own so the merge is observed accumulating across runs, which is exactly
    // what a fingerprint with no stage component is for. R5.3 allows it. (A
    // chained run would now reach security too — skill-lint's findings here are
    // LOW only, so §8.1 row 12b passes validate while keeping them.)
    await h.exec(['run', SKILL, '--stage', 'validate', '--json'])
    await h.exec(['run', SKILL, '--stage', 'security', '--json'])

    const ledger = openLedger(h.dbPath)
    try {
      const skillId = (
        ledger.db.prepare('select id from skills limit 1').get() as { id: string }
      ).id
      const fp = fingerprint(skillId, MERGED, 'unsafe-script')

      // skillspector AST4 twice, skill-lint R06 once: one issue, three
      // detections, two detectors — across two stages, because the fingerprint
      // carries no stage component.
      expect(
        ledger.db.prepare('select count(*) as n from issue_detections where issue_fp = ?').get(fp),
      ).toEqual({ n: 3 })
      const detectors = ledger.db
        .prepare('select tool_id from issue_detectors where issue_fp = ? order by tool_id')
        .all(fp) as Array<{ tool_id: string }>
      expect(detectors.map((d) => d.tool_id)).toEqual(['skill-lint', 'skillspector'])

      expect(
        ledger.db.prepare('select count(*) as n from issues where skill_id = ?').get(skillId),
      ).toEqual({ n: 4 })
      // Two, not three: occurrence_count answers "how many times was this seen
      // last time we looked", and the last look was the security-only run.
      expect(
        ledger.db.prepare('select occurrence_count from issues where fingerprint = ?').get(fp),
      ).toEqual({ occurrence_count: 2 })

      // skill-lint did not run in the security run, so its detector reported no
      // conclusive absence and its own issue stays open — R8.8's fail-safe.
      const lintOnly = fingerprint(skillId, LINT_ONLY, 'unsafe-script')
      expect(
        ledger.db.prepare('select state from issues where fingerprint = ?').get(lintOnly),
      ).toEqual({ state: 'open' })
    } finally {
      ledger.close()
    }

    // The evidence the ledger points at is on disk, one directory per tool.
    const runDir = await runDirOf(h.repoPath)
    const sarif = await readFile(join(runDir, '03-security/skillspector/findings.sarif'), 'utf8')
    expect(sarif).toContain('AST4')
  })

  it('two tools writing findings.sarif in one fan-out stage each keep their own file', async () => {
    const h = await harness()
    // Both security tools selected, both emitting a file of the same name into
    // their own artefact directory. skill-scanner needs a credential to run at
    // all, so the run also proves the one-of requirement is satisfiable.
    await saveConfig(h.home, {
      ...(await loadConfig(h.home)),
      stageTools: {
        validate: [],
        evaluate: [],
        security: ['skillspector', 'skill-scanner'],
        optimise: [],
      },
    })
    await h.exec(['run', SKILL, '--stage', 'security', '--json'])

    const stageDir = join(await runDirOf(h.repoPath), '03-security')
    for (const tool of ['skillspector', 'skill-scanner']) {
      const sarif = await readFile(join(stageDir, tool, 'findings.sarif'), 'utf8')
      expect(sarif.length).toBeGreaterThan(0)
    }

    const stageJson = JSON.parse(await readFile(join(stageDir, 'stage.json'), 'utf8')) as {
      toolRuns: Array<{ toolId: string; artefactDir: string; outcome: string }>
    }
    expect(stageJson.toolRuns.map((t) => t.toolId).sort()).toEqual([
      'skill-scanner',
      'skillspector',
    ])
    for (const run of stageJson.toolRuns) {
      // Suffix, not the whole path: the recorded directory is canonicalised, and
      // on macOS the temp root resolves through /private.
      expect(run.artefactDir.endsWith(join('03-security', run.toolId))).toBe(true)
      expect(run.outcome).toBe('failed')
    }
  })

  it('the merged issue closes only once both detectors have run clean, in either finish order', () => {
    for (const order of [
      ['skill-lint', 'skillspector'],
      ['skillspector', 'skill-lint'],
    ]) {
      const ledger = openLedger(':memory:')
      recordRun(
        ledger,
        runInput('run-1', [
          {
            stage: 'validate',
            outcome: 'failed',
            verdict: 'failed',
            toolRuns: [toolRun('skill-lint', [finding('unsafe-script', MERGED, 'R06')])],
          },
          {
            stage: 'security',
            outcome: 'failed',
            verdict: 'failed',
            toolRuns: [toolRun('skillspector', [finding('unsafe-script', MERGED, 'AST4')])],
          },
        ]),
      )

      const clear = (tool: string): StageResult[] => [
        {
          stage: tool === 'skill-lint' ? 'validate' : 'security',
          outcome: 'passed',
          verdict: 'passed',
          toolRuns: [toolRun(tool, [], 'passed')],
        },
      ]
      const fp = fingerprint(skillRef.id, MERGED, 'unsafe-script')

      recordRun(ledger, runInput('run-2', clear(order[0] as string)))
      expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp)).toEqual({
        state: 'open',
      })

      recordRun(ledger, runInput('run-3', clear(order[1] as string)))
      expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp)).toEqual({
        state: 'fixed',
      })
      ledger.close()
    }
  })

  it('extending the rule-class map merges colliding issues without losing a detection', () => {
    const ledger = openLedger(':memory:')
    try {
      // Recorded before the map knew AST4: skillspector's finding lands as
      // unmapped:, skill-lint's as unsafe-script, on the same file.
      recordRun(
        ledger,
        runInput('run-1', [
          {
            stage: 'validate',
            outcome: 'failed',
            verdict: 'failed',
            toolRuns: [toolRun('skill-lint', [finding('unsafe-script', MERGED, 'R06')])],
          },
          {
            stage: 'security',
            outcome: 'failed',
            verdict: 'failed',
            toolRuns: [
              toolRun('skillspector', [
                finding('unmapped:skillspector:AST4', MERGED, 'AST4'),
                finding('unmapped:skillspector:AST4', MERGED, 'AST4'),
              ]),
            ],
          },
        ]),
      )
      const before = ledger.db.prepare('select count(*) as n from issue_detections').get() as {
        n: number
      }
      const stale = fingerprint(skillRef.id, MERGED, 'unmapped:skillspector:AST4' as never)
      ledger.db.prepare(`update issues set state = 'wontfix' where fingerprint = ?`).run(stale)

      const result = migrateRuleMap(ledger.db)
      expect(result.applied).toBe(RULE_CLASS_MAP_VERSION)
      expect(result.merged).toBe(1)

      const fp = fingerprint(skillRef.id, MERGED, 'unsafe-script')
      // Nothing lost: every detection is re-parented, both detectors survive,
      // and the strongest state wins the merge.
      expect(ledger.db.prepare('select count(*) as n from issue_detections').get()).toEqual(before)
      expect(
        ledger.db.prepare('select count(*) as n from issue_detections where issue_fp = ?').get(fp),
      ).toEqual(before)
      expect(
        ledger.db.prepare('select count(*) as n from issue_detectors where issue_fp = ?').get(fp),
      ).toEqual({ n: 2 })
      expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp)).toEqual({
        state: 'wontfix',
      })
      // The two identities collapse into one: that is what the merge is.
      expect(ledger.db.prepare('select count(*) as n from issues').get()).toEqual({ n: 1 })
    } finally {
      ledger.close()
    }
  })

  it('every registered adapter parses its own fixture with no filesystem access', async () => {
    // R4.3 over every shipped parser, not just skillspector's. The fixtures are
    // read here, by the test; the parsers receive bytes.
    const fixtures: Record<string, Record<string, string>> = {
      skillspector: { 'findings.sarif': 'tests/fixtures/sarif/skillspector-declawed.sarif' },
      'skill-scanner': {
        'findings.sarif': 'tests/fixtures/sarif/skill-scanner-insight-profile.sarif',
      },
      'skill-up': {
        'iteration-1/report.json': 'tests/fixtures/skill-up/declawed-iteration-1.report.json',
      },
      'skill-lint': {},
    }
    const stdoutFixture: Record<string, string> = {
      'skill-lint': 'tests/fixtures/skill-lint/architecture-diagram.json',
    }

    const fs = await import('node:fs')
    seal.on = true
    try {
      // The seal must not be vacuous: prove it bites before trusting a pass.
      expect(() => fs.readFileSync('/dev/null')).toThrow(/a parser called node:fs/)

      for (const adapter of listAdapters()) {
        const declared = fixtures[adapter.manifest.id]
        expect(declared, `no fixture registered for ${adapter.manifest.id}`).toBeDefined()

        const artefacts = new Map<string, Buffer>()
        for (const [name, path] of Object.entries(declared as Record<string, string>)) {
          artefacts.set(name, await readFile(path))
        }
        const stdoutPath = stdoutFixture[adapter.manifest.id]
        const stdout = stdoutPath === undefined ? '' : await readFile(stdoutPath, 'utf8')

        const result = adapter.parse({
          skill: { ...skillRef, relPath: 'declawed' },
          artefacts,
          stdout,
          stderr: '',
          exitCode: 1,
          durationMs: 10,
        })
        expect(['passed', 'failed'], `${adapter.manifest.id} errored`).toContain(result.outcome)
      }
    } finally {
      seal.on = false
    }
  })
})
