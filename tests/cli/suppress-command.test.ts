import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProgram, selectSkill, type CliDeps } from '../../src/cli/run-command.js'
import { DEFAULT_CONFIG, registerRepo, saveConfig } from '../../src/core/config/config.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { buildFixPrompt } from '../../src/core/stages/fix-prompt.js'
import type { RepoRef, SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

/** fix-command.test.ts's shape: a real home, a real repo, a collecting writer. */
async function harness(): Promise<{ deps: CliDeps; skill: SkillRef; lines: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  // Through the *registered* path, not the raw tmp one: §4.1 canonicalises on
  // registration, so on macOS `/var/...` becomes `/private/var/...` and a
  // fixture built from the raw path disagrees with the one the command sees.
  const root = await realpath(
    await makeRepo({
      files: { 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'sk/scripts/scan.py': '# x\n' },
    }),
  )
  await saveConfig(home, DEFAULT_CONFIG)
  await registerRepo(home, root)

  const repo: RepoRef = { id: 'fx', path: root, name: 'fx', isGit: false }
  const skill = (await discoverSkills(repo))[0]!
  const lines: string[] = []
  return {
    deps: { home, dbPath: join(home, 'gantry.db'), write: (line) => lines.push(line) },
    skill,
    lines,
  }
}

const baselineOf = (skill: SkillRef): string => join(skill.dir, '.skillspector-baseline.yaml')

describe('skillgantry suppress', () => {
  it('prints the diff and writes nothing without --yes', async () => {
    const { deps, skill, lines } = await harness()
    const program = buildProgram(deps)
    await program.parseAsync(
      [
        'suppress',
        'sk',
        '--tool',
        'skillspector',
        '--rule',
        'MP2',
        '--path',
        'scripts/scan.py',
        '--reason',
        'alignment whitespace',
      ],
      { from: 'user' },
    )
    expect(lines.join('\n')).toContain('id: MP2')
    expect(program.exitCode).not.toBe(0)
    await expect(stat(baselineOf(skill))).rejects.toThrow()
  })

  it('emits the diff immediately before the write with --yes', async () => {
    const { deps, skill, lines } = await harness()
    const program = buildProgram(deps)
    await program.parseAsync(
      [
        'suppress',
        'sk',
        '--tool',
        'skillspector',
        '--rule',
        'MP2',
        '--path',
        'scripts/scan.py',
        '--reason',
        'alignment whitespace',
        '--yes',
      ],
      { from: 'user' },
    )
    expect(program.exitCode).toBe(0)
    expect(await readFile(baselineOf(skill), 'utf8')).toContain('id: MP2')
    expect(lines.findIndex((line) => line.includes('id: MP2'))).toBeLessThan(
      lines.findIndex((line) => line.includes('.skillspector-baseline.yaml written')),
    )
  })

  // R12.7: the code tracks the write, not the skill. Reusing R12.2's meaning
  // would make a clean skill indistinguishable from a failed lookup.
  it('exits non-zero naming the tool when it declares no baseline', async () => {
    const { deps, lines } = await harness()
    const program = buildProgram(deps)
    await program.parseAsync(
      [
        'suppress',
        'sk',
        '--tool',
        'skill-scanner',
        '--rule',
        'SS-9',
        '--path',
        'SKILL.md',
        '--reason',
        'r',
        '--yes',
      ],
      { from: 'user' },
    )
    expect(program.exitCode).not.toBe(0)
    expect(lines.join('\n')).toContain('skill-scanner declares no baseline')
  })

  it('refuses an empty reason', async () => {
    const { deps, lines } = await harness()
    const program = buildProgram(deps)
    await program.parseAsync(
      [
        'suppress',
        'sk',
        '--tool',
        'skillspector',
        '--rule',
        'MP2',
        '--path',
        'scripts/scan.py',
        '--reason',
        '   ',
        '--yes',
      ],
      { from: 'user' },
    )
    expect(program.exitCode).not.toBe(0)
    expect(lines.join('\n')).toContain('reason is required')
  })

  it('reports an entry already present and exits non-zero', async () => {
    const { deps, skill, lines } = await harness()
    await writeFile(
      baselineOf(skill),
      'version: 2\nrules:\n  - id: MP2\n    path: scripts/scan.py\n    reason: r\n',
    )
    const program = buildProgram(deps)
    await program.parseAsync(
      [
        'suppress',
        'sk',
        '--tool',
        'skillspector',
        '--rule',
        'MP2',
        '--path',
        'scripts/scan.py',
        '--reason',
        'r',
        '--yes',
      ],
      { from: 'user' },
    )
    expect(program.exitCode).not.toBe(0)
    expect(lines.join('\n')).toContain('already suppressed')
  })

  it('emits one json document with --json', async () => {
    const { deps, skill, lines } = await harness()
    const program = buildProgram(deps)
    await program.parseAsync(
      [
        'suppress',
        'sk',
        '--tool',
        'skillspector',
        '--rule',
        'MP2',
        '--path',
        'scripts/scan.py',
        '--reason',
        'r',
        '--yes',
        '--json',
      ],
      { from: 'user' },
    )
    const doc = JSON.parse(lines.join('\n')) as { written: string[]; uncovered: string[] }
    expect(doc.written).toEqual([baselineOf(skill)])
    expect(doc.uncovered).toEqual([])
  })
})

/**
 * R6.14's coupling. The prompt composes a command line and this command parses
 * one; a change to either side alone leaves an agent running a line that no
 * longer means what the prompt intended, and neither module's own tests can
 * see it.
 */
describe('the line R6.14 emits is one this command accepts', () => {
  /**
   * The subset of shell splitting the emitted line uses: single-quoted runs and
   * bare words. Not a shell — no backslashes, no double quotes, no adjacent-token
   * concatenation. `prompt-parts.ts`'s `arg` is what keeps the line inside that
   * subset, and the apostrophe case is pinned there rather than here.
   */
  const splitArgv = (line: string): string[] =>
    (line.match(/'[^']*'|\S+/g) ?? []).map((token) =>
      token.startsWith("'") ? token.slice(1, -1) : token,
    )

  it('writes the same entry the skill-relative form does', async () => {
    const { deps } = await harness()
    // Resolved the way the pipeline resolves it, so the selector the prompt
    // writes is one `suppress` can look up. A hand-built `RepoRef` carries an
    // id the registered config does not know.
    const { skill } = await selectSkill(deps.home, 'sk')
    const prompt = buildFixPrompt({
      skill,
      runId: '019fcd9e',
      stageDir: join(skill.workspacePath, 'skillgantry/runs/019fcd9e/03-security'),
      skillDigest: 'sha256:abc123',
      git: { commit: null, dirty: false },
      result: {
        stage: 'security',
        outcome: 'failed',
        verdict: 'failed',
        toolRuns: [
          {
            toolId: 'skillspector',
            toolVersion: '2.5.1',
            outcome: 'failed',
            exitCode: 1,
            durationMs: 1,
            errorKind: null,
            artefactDir: 'x',
            metrics: {},
            summary: '1 finding',
            findings: [
              {
                ruleClass: 'prompt-injection',
                nativeRuleId: 'MP2',
                severity: 'medium',
                path: `${skill.relPath}/scripts/scan.py`,
                line: 34,
                message: 'Context Window Stuffing',
              },
            ],
          },
        ],
      },
    }) as string

    const emitted = prompt
      .split('\n')
      .find((l) => l.includes('skillgantry suppress')) as string
    const argv = splitArgv(emitted.slice(emitted.indexOf('skillgantry suppress')).replace(/`$/, ''))
    // An agent replaces the placeholder before running it; everything else is
    // taken verbatim, which is the point.
    const reasonAt = argv.indexOf('--reason') + 1
    argv[reasonAt] = 'alignment inside a re.VERBOSE block'

    // `skillgantry` itself is the binary, so it is not part of the argv the
    // program parses — the rest must be, unchanged.
    expect(argv[0]).toBe('skillgantry')
    await buildProgram(deps).parseAsync(argv.slice(1), { from: 'user' })

    const written = await readFile(baselineOf(skill), 'utf8')
    expect(written).toContain('id: MP2')
    // The repo-relative path the table displays, rebased to the skill-relative
    // form the tool globs against.
    expect(written).toContain('path: scripts/scan.py')
    expect(written).not.toContain(`path: ${skill.relPath}/scripts/scan.py`)
    expect(written).toContain('alignment inside a re.VERBOSE block')
  })
})
