import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/run-command.js'
import { registerRepo, saveToolLock } from '../../src/core/config/config.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { listIssues } from '../../src/core/ledger/issue-queries.js'
import { dashboard } from '../../src/core/ledger/stats.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const REASON = 'alignment whitespace in a re.VERBOSE block, not padding'

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
            ...(suppressed ? { suppressions: [{ kind: 'external', justification: REASON }] } : {}),
          },
        ],
      },
    ],
  })

/**
 * m6-baseline.test.ts's fixture: the manifest's argv ends at `$7`, so the
 * conditional group lands at `$8`. Branching on it is what makes this end to
 * end — the tool only annotates when SkillGantry actually passed it the flag.
 *
 * Here the baseline starts *absent*, so the branch is exercised by `suppress`
 * creating it. What this cannot prove is that the rule inside the file is one
 * the tool's own fnmatch matches — no shell fixture implements fnmatch, which
 * is what `tests/core/suppress-integration.test.ts` reaches a real binary for.
 */
const SCRIPT = `
if [ "$8" = "--baseline" ] && [ -f "$9" ] && grep -q 'id: MP2' "$9"; then
  printf '%s' '${sarif(true)}' > "$7"
else
  printf '%s' '${sarif(false)}' > "$7"
fi
`

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-acc-home-'))
  const repoPath = await makeRepo({
    files: {
      'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
      'declawed/scripts/scan.py': 'print("hi")\n',
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

const baselinePath = (repoPath: string): string =>
  join(repoPath, 'declawed/.skillspector-baseline.yaml')

describe('M8 suppression round trip', () => {
  it('fails, accepts the finding, and passes on the re-run', async () => {
    const h = await harness()

    // 1. The gate fails on MP2 and the ledger files one open issue.
    expect(await h.exec(['run', 'declawed', '--stage', 'security'])).not.toBe(0)

    const first = openLedger(h.dbPath)
    const before = listIssues(first.db, {})
    expect(before).toHaveLength(1)
    expect(before[0]?.state).toBe('open')
    expect(before[0]?.suppressed).toBe(false)
    const fingerprint = before[0]!.fingerprint
    const firstSeen = before[0]!.lastSeenRun
    first.close()

    // 2. Accept it. The baseline did not exist, so this creates it.
    h.out.length = 0
    expect(
      await h.exec(['suppress', 'declawed', '--fingerprint', fingerprint, '--reason', REASON, '--yes']),
    ).toBe(0)
    const baseline = await readFile(baselinePath(h.repoPath), 'utf8')
    expect(baseline).toContain('id: MP2')
    // The skill-relative form the tool globs against, not the repo-relative
    // one `RawFinding.path` carries.
    expect(baseline).toContain('path: scripts/scan.py')
    expect(baseline).not.toContain('declawed/scripts/scan.py')
    // Nothing is left staged beside it.
    expect(await readdir(join(h.repoPath, 'declawed'))).not.toContain('.skillgantry-write.tmp')

    // 3. The re-run passes, and the finding is still reported — R4.15 makes it
    //    annotated, never dropped, which is what keeps the issue's history.
    expect(await h.exec(['run', 'declawed', '--stage', 'security'])).toBe(0)

    // 4. R8.15: suppressed, still open, history intact, absent from the counts.
    const after = openLedger(h.dbPath)
    const row = listIssues(after.db, {})[0]
    expect(row?.suppressed).toBe(true)
    expect(row?.state).toBe('open')
    expect(row?.fingerprint).toBe(fingerprint)
    expect(row?.lastSeenRun).not.toBe(firstSeen)
    expect(row?.suppressionReason).toContain('alignment whitespace')
    const stats = dashboard(after.db, {})
    expect(stats.openSuppressed).toBe(1)
    expect(stats.openBySeverity).toEqual([])
    after.close()

    // 5. Delete the entry and the finding comes back — the file is the
    //    authority, so removing the rule un-suppresses on the next run.
    await writeFile(baselinePath(h.repoPath), 'version: 2\nrules: []\n')
    expect(await h.exec(['run', 'declawed', '--stage', 'security'])).not.toBe(0)
    const final = openLedger(h.dbPath)
    const back = listIssues(final.db, {})[0]
    expect(back?.suppressed).toBe(false)
    expect(back?.fingerprint).toBe(fingerprint)
    final.close()
  })

  it('writes nothing without --yes, and refuses a second identical entry', async () => {
    const h = await harness()
    await h.exec(['run', 'declawed', '--stage', 'security'])

    const args = [
      'suppress',
      'declawed',
      '--tool',
      'skillspector',
      '--rule',
      'MP2',
      '--path',
      'declawed/scripts/scan.py',
      '--reason',
      REASON,
    ]

    // R12.4: the diff is on stdout, and nothing is written.
    h.out.length = 0
    expect(await h.exec(args)).not.toBe(0)
    expect(h.out.join('\n')).toContain('id: MP2')
    await expect(readFile(baselinePath(h.repoPath), 'utf8')).rejects.toThrow()

    expect(await h.exec([...args, '--yes'])).toBe(0)
    const written = await readFile(baselinePath(h.repoPath), 'utf8')

    // Without the identical-entry stop, this stacks a duplicate rule in the
    // user's repo and nothing downstream notices.
    h.out.length = 0
    expect(await h.exec([...args, '--yes'])).not.toBe(0)
    expect(h.out.join('\n')).toContain('already suppressed')
    expect(await readFile(baselinePath(h.repoPath), 'utf8')).toBe(written)
  })
})
