import { describe, expect, it } from 'vitest'
import { buildEvalPrompt } from '../../src/core/stages/eval-prompt.js'
import { buildFixPrompt } from '../../src/core/stages/fix-prompt.js'
import { buildOptimisePrompt } from '../../src/core/stages/optimise-prompt.js'
import { verifySection } from '../../src/core/stages/prompt-parts.js'
import type { SkillRef } from '../../src/core/types.js'

const SKILL = {
  id: 'zapac/declawed',
  name: 'declawed',
  version: '1.2.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  workspacePath: '/repo/declawed-workspace',
  repo: { id: 'zapac', path: '/repo' },
} as SkillRef

describe('verifySection', () => {
  it('names the re-run for one stage and the status command', () => {
    expect(verifySection('zapac/declawed', ['security'])).toEqual([
      '## Verify',
      '',
      '- Re-verify with `skillgantry run zapac/declawed --stage security`. It exits 1 while any stage is not `passed`; that is a result, not an error.',
      '- `skillgantry status zapac/declawed` lists what still stands between this skill and a release.',
    ])
  })

  it('joins several stages with a bare comma, the spelling `--stage` accepts', () => {
    expect(verifySection('s/x', ['validate', 'evaluate', 'security'])[2]).toContain(
      '`skillgantry run s/x --stage validate,evaluate,security`',
    )
  })
})

describe('the three prompts close with one section', () => {
  // A copy in each prompt is what lets the three drift: this fails when any
  // of them stops composing the shared function.
  const section = (id: string, stages: string[]): string =>
    verifySection(id, stages as never).join('\n')

  it('fix, optimise and eval each carry exactly what verifySection returns for their stages', () => {
    const fix = buildFixPrompt({
      skill: SKILL,
      runId: 'r1',
      stageDir: '/runs/r1/03-security',
      skillDigest: 'sha256:abc',
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
            artefactDir: '/runs/r1/03-security/skillspector',
            findings: [
              {
                ruleClass: 'prompt-injection',
                nativeRuleId: 'P2',
                severity: 'high',
                path: 'SKILL.md',
                message: 'm',
              },
            ],
            metrics: {},
            summary: '',
          },
        ],
      },
    }) as string
    const optimise = buildOptimisePrompt({
      skill: SKILL,
      evidence: [],
      evalAssets: [],
      install: { interpreter: 'py', skillsDir: '/s', sha: 'abc', missing: [] },
    })
    const evaluate = buildEvalPrompt({
      skill: SKILL,
      evalAssets: [],
      hasSuite: false,
      install: { runner: 'skill-up', pin: 'v1', authoringSkillDir: '/a', missing: [] },
    })

    expect(fix).toContain(section('zapac/declawed', ['security']))
    expect(optimise).toContain(section('zapac/declawed', ['validate', 'evaluate', 'security']))
    expect(evaluate).toContain(section('zapac/declawed', ['evaluate']))
  })
})
