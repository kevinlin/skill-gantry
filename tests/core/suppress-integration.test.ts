import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { getAdapter } from '../../src/core/adapters/registry.js'
import { loadToolLock } from '../../src/core/config/config.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { applySuppression, previewSuppression } from '../../src/core/index.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const run = promisify(execFile)

// A skill skillspector reports on with `--no-llm`. The padded run is MP2's
// trigger — the same finding the M6 baseline work was prompted by.
const PADDED = `# scan\nPATTERN = r"""\n  a${' '.repeat(400)}\n"""\n`

interface Sarif {
  runs: Array<{
    results: Array<{
      ruleId: string
      suppressions?: unknown[]
      locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>
    }>
  }>
}

/**
 * The one test worth reaching a real binary for. A wrong path shape produces a
 * rule that loads cleanly, matches nothing, and leaves the stage failing
 * exactly as before with no error anywhere — and the acceptance tier cannot
 * catch it, because its fake tool branches on whether the flag arrived, which
 * is a different question from whether the rule inside the file matches. No
 * shell fixture implements fnmatch.
 */
describe('the written rule is one skillspector matches', () => {
  it('suppresses on a real re-scan', async () => {
    const home = process.env.SKILLGANTRY_HOME ?? join(homedir(), '.skillgantry')
    const bin = (await loadToolLock(home)).tools['skillspector']?.bin
    // Loud, never skipped: a silently skipped integration test is how this
    // regression ships.
    expect(bin, `skillspector must be installed and locked under ${home}`).toBeDefined()

    const root = await makeRepo({
      files: { 'declawed/SKILL.md': SKILL_MD('declawed'), 'declawed/scripts/scan.py': PADDED },
    })
    const repo: RepoRef = { id: 'fx', path: root, name: 'fx', isGit: false }
    const skill = (await discoverSkills(repo))[0]!
    // The path the manifest declares, resolved the way §12.5 resolves it, so
    // this test reads the flag off the same constant the writer does.
    const baseline = getAdapter('skillspector')!.manifest.baseline!.path.replace(
      '{skillDir}',
      skill.dir,
    )

    const scan = async (withBaseline: boolean): Promise<Sarif> => {
      const out = join(root, 'findings.sarif')
      await run(bin!, [
        'scan',
        skill.dir,
        '--no-llm',
        '--format',
        'sarif',
        '--output',
        out,
        ...(withBaseline ? ['--baseline', baseline] : []),
      ]).catch(() => undefined) // a scan with findings exits non-zero
      return JSON.parse(await readFile(out, 'utf8')) as Sarif
    }
    const suppressedCount = (sarif: Sarif): number =>
      (sarif.runs[0]?.results ?? []).filter((r) => (r.suppressions?.length ?? 0) > 0).length

    // Nothing suppressed before, and at least one finding to suppress.
    const before = await scan(false)
    expect(before.runs[0]?.results.length ?? 0).toBeGreaterThan(0)
    expect(suppressedCount(before)).toBe(0)

    const first = before.runs[0]!.results[0]!
    const preview = await previewSuppression({
      skill,
      reason: 'accepted by the integration test',
      rules: [
        {
          toolId: 'skillspector',
          nativeRuleId: first.ruleId,
          // Repo-relative, exactly as RawFinding carries it — the conversion
          // to the skill-relative form the tool globs against is the thing
          // under test.
          relPath: `${skill.relPath}/${first.locations[0]!.physicalLocation.artifactLocation.uri}`,
        },
      ],
      stillReporting: ['skillspector'],
    })
    for (const plan of preview.plans) await applySuppression(plan)

    // The whole point: skillspector's own fnmatch must match what we wrote.
    expect(suppressedCount(await scan(true))).toBeGreaterThan(0)
  }, 120_000)
})
