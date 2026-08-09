import { describe, expect, it } from 'vitest'
import { buildOptimisePrompt } from '../../src/core/stages/optimise-prompt.js'
import type { SkillRef } from '../../src/core/types.js'

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

describe('buildOptimisePrompt', () => {
  it('names the skill, the interpreter and the workspace prohibition with no recorded run', () => {
    const body = buildOptimisePrompt({
      skill: SKILL,
      lastRun: null,
      evalAssets: [],
      install: INSTALL,
    })

    expect(body).toContain('/repo/declawed')
    expect(body).toContain('/tools/skillhone/.venv/bin/python')
    expect(body).toContain('*-workspace/')
    // Absent evidence is stated, never omitted: a section that vanishes reads
    // as a builder that failed.
    expect(body).toContain('no recorded run')
  })

  it('omits suppressed findings and says how many, per R6.11', () => {
    const body = buildOptimisePrompt({
      skill: SKILL,
      lastRun: {
        runId: '019fe5c3',
        runDir: '/repo/declawed-workspace/skillgantry/runs/019fe5c3',
        skillDigest: 'sha256:7f3a',
        git: { commit: 'a1b2c3d', dirty: false },
        stages: [
          {
            stage: 'security',
            result: {
              stage: 'security',
              outcome: 'failed',
              toolRuns: [
                {
                  toolId: 'skillspector',
                  outcome: 'failed',
                  artefactDir: '/runs/019fe5c3/03-security/skillspector',
                  findings: [
                    {
                      ruleClass: 'prompt-injection',
                      severity: 'high',
                      path: 'SKILL.md',
                      message: 'interpolates untrusted text',
                      nativeRuleId: 'P2',
                      // Absent means unsuppressed — `suppressed` carries the
                      // tool's own justification, not a flag.
                    },
                    {
                      ruleClass: 'unsafe-script',
                      severity: 'medium',
                      path: 'scripts/scan.py',
                      message: 'alignment whitespace',
                      nativeRuleId: 'MP2',
                      suppressed: { justification: 'alignment in a re.VERBOSE block' },
                    },
                  ],
                },
              ],
            },
          },
        ],
      } as never,
      evalAssets: ['declawed/evals/eval.yaml'],
      install: INSTALL,
    })

    expect(body).toContain('prompt-injection')
    expect(body).not.toContain('alignment whitespace')
    expect(body).toContain('1 suppressed finding')
    // §9.4's rule: point at the report, do not restate it.
    expect(body).toContain('/runs/019fe5c3/03-security/skillspector')
    expect(body).toContain('declawed/evals/eval.yaml')
  })

  it('names a missing dependency before the task, so no prompt describes a loop that cannot start', () => {
    const body = buildOptimisePrompt({
      skill: SKILL,
      lastRun: null,
      evalAssets: [],
      install: { ...INSTALL, missing: ['claude CLI'] },
    })

    expect(body.indexOf('claude CLI')).toBeLessThan(body.indexOf('## Task'))
  })
})
