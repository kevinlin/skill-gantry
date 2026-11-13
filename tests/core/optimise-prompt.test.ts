import { describe, expect, it } from 'vitest'
import {
  buildOptimisePrompt,
  type OptimisePromptInput,
} from '../../src/core/stages/optimise-prompt.js'
import type { SkillRef } from '../../src/core/types.js'
import { baselineForSkillspector } from '../helpers/manifest-lookup.js'

const SKILL: SkillRef = {
  id: 'zapac/declawed',
  name: 'declawed',
  version: '1.2.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  workspacePath: '/repo/declawed-workspace',
  repo: { id: 'zapac', path: '/repo' },
} as SkillRef

const INSTALL = {
  interpreter: '/tools/skillhone/.venv/bin/python',
  skillsDir: '/home/.claude/skills',
  sha: '7d56583',
  missing: [] as string[],
}

/** Absent `suppressed` means unsuppressed — it carries the tool's own justification, not a flag. */
const FINDING = {
  ruleClass: 'prompt-injection',
  severity: 'high',
  path: 'SKILL.md',
  message: 'interpolates untrusted text',
  nativeRuleId: 'P2',
}

type Evidence = OptimisePromptInput['evidence'][number]

/**
 * One stage's recorded evidence. Shared rather than spelled out per suite:
 * `StageResult` gains fields, and `as never` means the compiler will point at
 * neither copy when it does.
 */
const evidence = ({
  stage = 'security',
  outcome = 'failed',
  toolId = 'skillspector',
  findings = [FINDING] as unknown[],
  runId = '019fe5c3',
  skillDigest = 'sha256:7f3a',
  git = { commit: 'a1b2c3d', dirty: false },
  current = true,
}: {
  stage?: string
  outcome?: string
  toolId?: string
  findings?: unknown[]
  runId?: string
  skillDigest?: string
  git?: { commit: string | null; dirty: boolean }
  current?: boolean
} = {}): Evidence =>
  ({
    stage,
    result: {
      stage,
      outcome,
      toolRuns: [
        {
          toolId,
          outcome,
          artefactDir: `/runs/${runId}/${stage}/${toolId}`,
          findings,
        },
      ],
    },
    runId,
    runDir: `/repo/declawed-workspace/skillgantry/runs/${runId}`,
    skillDigest,
    git,
    current,
  }) as never

const build = (over: Partial<OptimisePromptInput> = {}): string =>
  buildOptimisePrompt({ skill: SKILL, evidence: [], evalAssets: [], install: INSTALL, ...over })

describe('buildOptimisePrompt', () => {
  it('names the skill, the interpreter and the workspace prohibition with no recorded run', () => {
    const body = build()

    expect(body).toContain('/repo/declawed')
    expect(body).toContain('/tools/skillhone/.venv/bin/python')
    expect(body).toContain('*-workspace/')
    // Absent evidence is stated, never omitted: a section that vanishes reads
    // as a builder that failed.
    expect(body).toContain('There is no recorded run for this skill yet.')
  })

  it('opens under the title with whose work this is and what it is for', () => {
    const lines = build().split('\n')
    expect(lines[0]).toBe('# Optimise: declawed')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe(
      'You are working for the maintainer of this skill. They want it to do its job better — sharper triggering, better eval results, fewer findings — without changing what it is for. Below is where the skill is, what SkillGantry has recorded about it, and the optimiser to use.',
    )
  })

  it('omits suppressed findings and says how many', () => {
    const body = build({
      evidence: [
        evidence({
          findings: [
            FINDING,
            {
              ruleClass: 'unsafe-script',
              severity: 'medium',
              path: 'scripts/scan.py',
              message: 'alignment whitespace',
              nativeRuleId: 'MP2',
              suppressed: { justification: 'alignment in a re.VERBOSE block' },
            },
          ],
        }),
      ],
      evalAssets: ['declawed/evals/eval.yaml'],
    })

    expect(body).toContain('prompt-injection')
    expect(body).not.toContain('alignment whitespace')
    expect(body).toContain('1 suppressed finding')
    // §9.4's rule: point at the report, do not restate it.
    expect(body).toContain('/runs/019fe5c3/security/skillspector')
    expect(body).toContain('declawed/evals/eval.yaml')
  })

  it('names a missing dependency before the task, so no prompt describes a loop that cannot start', () => {
    const body = build({ install: { ...INSTALL, missing: ['claude CLI'] } })

    expect(body.indexOf('claude CLI')).toBeLessThan(body.indexOf('## Task'))
  })

  it('shows the line number in the Location column when the finding has one', () => {
    const body = build({
      evidence: [
        evidence({
          findings: [
            { ...FINDING, line: 58 },
            { ...FINDING, nativeRuleId: 'P3', path: 'scripts/scan.py', message: 'no line recorded' },
          ],
        }),
      ],
    })

    expect(body).toContain('| 1 | skillspector | high | prompt-injection | SKILL.md:58 | interpolates untrusted text |')
    expect(body).toContain('| 2 | skillspector | high | prompt-injection | scripts/scan.py | no line recorded |')
  })
})

describe('R6.12 evidence per stage, across runs', () => {
  const CURRENT = 'Recorded by run `019fe5c3` against the skill\'s current files.'
  const HISTORY =
    'Recorded by run `019fe5b0` against an earlier version of the skill. Treat it as history, and re-run the stage before relying on it.'

  it('renders each stage under its own heading with the run it was recorded by', () => {
    const body = build({
      evidence: [
        evidence({ stage: 'evaluate', outcome: 'passed', runId: '019fe5b0', findings: [] }),
        evidence({ stage: 'security' }),
      ],
    })

    expect(body).toContain('### evaluate — `passed`\n\nRecorded by run `019fe5b0` against')
    expect(body).toContain(`### security — \`failed\`\n\n${CURRENT}\n`)
  })

  it('says a result recorded against the current digest describes the current files', () => {
    const body = build({ evidence: [evidence({ current: true })] })

    expect(body).toContain(CURRENT)
    expect(body).not.toContain('earlier version')
  })

  it('marks a result recorded against another digest as history to re-run', () => {
    const body = build({
      evidence: [evidence({ runId: '019fe5b0', skillDigest: 'sha256:0000', current: false })],
    })

    expect(body).toContain(HISTORY)
    expect(body).not.toContain("against the skill's current files")
  })

  it('judges currency per stage, not per prompt', () => {
    const body = build({
      evidence: [
        evidence({ stage: 'evaluate', runId: '019fe5b0', skillDigest: 'sha256:0000', current: false }),
        evidence({ stage: 'security', current: true }),
      ],
    })

    expect(body).toContain(HISTORY)
    expect(body).toContain(CURRENT)
  })

  it('still names the digest and the commit each run was recorded against', () => {
    // R6.12: the commit, the dirty flag and the digest, now one line per run —
    // the stages no longer share one.
    const body = build({
      evidence: [
        evidence({ stage: 'evaluate', runId: '019fe5b0', skillDigest: 'sha256:0000', git: { commit: null, dirty: false }, current: false }),
        evidence({ stage: 'security', git: { commit: 'a1b2c3d', dirty: true } }),
      ],
    })

    expect(body).toContain('Run `019fe5b0` · digest `sha256:0000` · commit `none`')
    expect(body).toContain('Run `019fe5c3` · digest `sha256:7f3a` · commit `a1b2c3d` (dirty)')
  })

  it('names a run once when two stages came from it', () => {
    const body = build({
      evidence: [evidence({ stage: 'validate', findings: [] }), evidence({ stage: 'security' })],
    })

    expect(body.match(/Run `019fe5c3` · digest/g)).toHaveLength(1)
  })
})

describe('R6.15 the optimise prompt for an agent that drives the CLI', () => {
  const body = build({ evidence: [evidence()] })
  const at = (heading: string): number => body.indexOf(heading)

  it('says when the agent is done, and what to do with no eval suite', () => {
    expect(body).toContain(
      [
        '## Done when',
        '',
        'The eval suite passes at least as well as the recorded evaluate result, no gate that passed now fails, and you can say what you changed and why. With no eval suite there is nothing to measure against: say so, propose one, and stop. An optimisation nobody can measure is a rewrite.',
      ].join('\n'),
    )
  })

  it('orders Task, Done when, Constraints, Verify, Report back', () => {
    const order = ['## Task', '## Done when', '## Constraints', '## Verify', '## Report back']
    const positions = order.map(at)
    expect(positions.every((p) => p > -1)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('ends its constraints on what was not applied, without citing an id', () => {
    expect(body).toContain(
      '- Nothing here has been applied. SkillGantry does not run the optimiser; you do.',
    )
  })

  it('closes with the shared Verify section over the three gates', () => {
    expect(body).toContain(
      [
        '## Verify',
        '',
        '- Re-verify with `skillgantry run zapac/declawed --stage validate,evaluate,security`. It exits 1 while any stage is not `passed`; that is a result, not an error.',
        '- `skillgantry status zapac/declawed` lists what still stands between this skill and a release.',
      ].join('\n'),
    )
  })

  it('ends on what to report back', () => {
    expect(body.endsWith(
      '## Report back\n\nWhat you changed and why, the evaluate result before and after, and one line per finding with the judgement you reached.\n',
    )).toBe(true)
  })

  it('cites no requirement or decision id in the body', () => {
    for (const text of [
      body,
      build(),
      build({ evidence: [evidence()], lookup: baselineForSkillspector, install: { ...INSTALL, missing: ['x'] } }),
    ]) {
      expect(text).not.toMatch(/\bR\d+\.\d+\b/)
      expect(text).not.toMatch(/\bD\d+\b/)
      expect(text).not.toContain('§')
    }
  })

  it('names both verify commands with the skill id when there is no evidence either', () => {
    const empty = build()
    expect(empty).toContain('skillgantry run zapac/declawed --stage validate,evaluate,security')
    expect(empty).toContain('skillgantry status zapac/declawed')
  })
})

describe('R6.14 accepting a confirmed false positive', () => {
  const withTool = (toolId: string) =>
    build({
      evidence: [evidence({ toolId })],
      lookup: baselineForSkillspector,
    })

  it('names each finding its tool and labels the command by stage', () => {
    const body = withTool('skillspector')
    expect(body).toContain('| 1 | skillspector | high | prompt-injection | SKILL.md |')
    // Labelled by stage: this prompt renders every stage at once and each
    // numbers from 1, so a bare number would collide across stages.
    expect(body).toContain(
      "- security finding 1 — `skillgantry suppress zapac/declawed --tool skillspector --rule 'P2' --path 'SKILL.md' --reason '<why this finding is wrong>' --yes`",
    )
    expect(body).toContain('/repo/declawed/.skillspector-baseline.yaml')
    expect(body).toContain("never through the tool's own baseline command")
  })

  it('gives no command and no constraint when the detecting tool declares no baseline', () => {
    const body = withTool('skill-scanner')
    expect(body).not.toContain('## If a finding is a false positive')
    expect(body).not.toContain('skillgantry suppress')
    expect(body).not.toContain("never through the tool's own baseline command")
    // The finding is still rendered, still attributed — only unrecordable.
    expect(body).toContain('| 1 | skill-scanner | high | prompt-injection |')
  })

  it('keeps the suppress path free of the line number the table shows', () => {
    const body = build({
      evidence: [evidence({ findings: [{ ...FINDING, line: 58 }] })],
      lookup: baselineForSkillspector,
    })
    expect(body).toContain('| SKILL.md:58 |')
    expect(body).toContain("--path 'SKILL.md' --reason")
    expect(body).not.toContain("--path 'SKILL.md:58'")
  })
})
