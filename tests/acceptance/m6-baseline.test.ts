import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { registerRepo, saveToolLock } from '../../src/core/config/config.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const REASON = 'whitespace run is re.VERBOSE comment alignment, not context padding'

const sarif = (suppressed: boolean): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'skillspector', version: '2.5.1' } },
        results: [
          {
            ruleId: 'MP2',
            message: { text: 'Context Window Stuffing' },
            level: 'error',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'scripts/scan.py' },
                  region: { startLine: 34 },
                },
              },
            ],
            ...(suppressed
              ? { suppressions: [{ kind: 'external', justification: REASON }] }
              : {}),
          },
        ],
      },
    ],
  })

/**
 * The manifest's argv ends at `$7`, so the conditional group lands at `$8`.
 * Branching on it is what makes this end to end rather than two fixtures: the
 * tool only annotates when SkillGantry actually passed it the flag.
 */
const SCRIPT = `
if [ "$8" = "--baseline" ] && [ -f "$9" ]; then
  printf '%s' '${sarif(true)}' > "$7"
else
  printf '%s' '${sarif(false)}' > "$7"
fi
`

const BASELINE = `version: 1
rules:
  - id: "MP2"
    path: "*scripts/scan.py"
    reason: "${REASON}"
`

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({
    files: {
      'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
      'declawed/scripts/scan.py': 'print("hi")\n',
      'declawed/.skillspector-baseline.yaml': BASELINE,
    },
  })
  await registerRepo(home, repoPath)

  const bin = await makeFakeTool('skillspector', SCRIPT)
  await saveToolLock(home, {
    version: 1,
    tools: {
      skillspector: {
        installKind: 'uv-tool',
        requestedPin: 'v2.5.1',
        resolvedVersion: '2.5.1',
        bin,
        integrity: 'n/a',
        installedAt: '2026-08-01T00:00:00Z',
        verifiedAt: '2026-08-01T00:00:00Z',
      },
    },
  })

  const dbPath = join(home, 'gantry.db')
  const out: string[] = []
  const exec = async (args: string[]): Promise<number> => {
    const program = buildProgram({ home, dbPath, write: (l) => out.push(l) })
    await program.exitOverride().parseAsync(['node', 'skillgantry', ...args])
    return program.exitCode ?? 0
  }
  return { home, repoPath, dbPath, out, exec }
}

const runDirOf = async (repoPath: string): Promise<string> => {
  const runs = join(repoPath, 'declawed-workspace/skillgantry/runs')
  const dirs = (await readdir(runs, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  return join(runs, dirs.at(-1) as string)
}

const stageJson = async (repoPath: string): Promise<Record<string, unknown>> =>
  JSON.parse(
    await readFile(join(await runDirOf(repoPath), '03-security/stage.json'), 'utf8'),
  ) as Record<string, unknown>

describe('M6: a baselined finding passes the gate and stays in the ledger', () => {
  it('passes, keeps the finding annotated, and files the issue open and suppressed', async () => {
    const h = await harness()
    const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])

    // The motivating case: MP2 is a `high`, so without the baseline this fails.
    expect(code).toBe(0)

    const events = h.out
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { type: string; result?: { outcome: string } })
    expect(events.find((e) => e.type === 'stage:done')?.result?.outcome).toBe('passed')

    // The finding is retained and annotated, not discarded.
    const stage = (await stageJson(h.repoPath)) as {
      outcome: string
      toolRuns: Array<{ summary: string; findings: Array<{ suppressed?: { justification: string } }> }>
    }
    expect(stage.outcome).toBe('passed')
    expect(stage.toolRuns[0]?.findings).toHaveLength(1)
    expect(stage.toolRuns[0]?.findings[0]?.suppressed?.justification).toBe(REASON)
    expect(stage.toolRuns[0]?.summary).toContain('1 suppressed')

    // A fully suppressed stage writes no fix prompt — R6.11.
    const runDir = await runDirOf(h.repoPath)
    const stageFiles = await readdir(join(runDir, '03-security'))
    expect(stageFiles).not.toContain('fix-prompt.md')

    const ledger = openLedger(h.dbPath)
    try {
      const issue = ledger.db
        .prepare('select state, suppressed_run, suppressed_reason from issues')
        .get() as { state: string; suppressed_run: string | null; suppressed_reason: string | null }
      // Reported, not absent: open, suppressed, and never closed as fixed.
      expect(issue.state).toBe('open')
      expect(issue.suppressed_run).not.toBeNull()
      expect(issue.suppressed_reason).toBe(REASON)

      const detector = ledger.db
        .prepare('select last_seen_run, last_absent_run from issue_detectors')
        .get() as { last_seen_run: string | null; last_absent_run: string | null }
      expect(detector.last_absent_run).toBeNull()
      expect(detector.last_seen_run).toBe(issue.suppressed_run)
    } finally {
      ledger.close()
    }

    // `fix` reports the suppression rather than an empty prompt — R12.6.
    h.out.length = 0
    expect(await h.exec(['fix', 'declawed', '--stage', 'security'])).toBe(1)
    expect(h.out.join('\n')).toMatch(/suppressed/)
  })

  it('fails again the run after the baseline entry is deleted', async () => {
    const h = await harness()
    await h.exec(['run', 'declawed', '--stage', 'security', '--json'])

    const first = openLedger(h.dbPath)
    const before = first.db.prepare('select fingerprint, first_seen_run from issues').get() as {
      fingerprint: string
      first_seen_run: string
    }
    first.close()

    // Removing the file is the round trip in full: the conditional group stops
    // firing (R4.14), so the tool is never handed a baseline and reports the
    // finding plainly again.
    await rm(join(h.repoPath, 'declawed/.skillspector-baseline.yaml'))

    h.out.length = 0
    const code = await h.exec(['run', 'declawed', '--stage', 'security', '--json'])
    expect(code).not.toBe(0)

    const ledger = openLedger(h.dbPath)
    try {
      const issue = ledger.db
        .prepare('select fingerprint, state, first_seen_run, suppressed_run from issues')
        .get() as {
        fingerprint: string
        state: string
        first_seen_run: string
        suppressed_run: string | null
      }
      // Same identity, same history, suppression cleared by the same run that
      // observed it unsuppressed.
      expect(issue.fingerprint).toBe(before.fingerprint)
      expect(issue.first_seen_run).toBe(before.first_seen_run)
      expect(issue.state).toBe('open')
      expect(issue.suppressed_run).toBeNull()
    } finally {
      ledger.close()
    }
  })
})
