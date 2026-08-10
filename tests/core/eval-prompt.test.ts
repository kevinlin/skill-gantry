import { describe, expect, it } from 'vitest'
import { getAdapter } from '../../src/core/adapters/registry.js'
import { buildEvalPrompt, type EvalPromptInput } from '../../src/core/stages/eval-prompt.js'
import type { SkillRef } from '../../src/core/types.js'

const SKILL: SkillRef = {
  id: 'zapac/declawed',
  name: 'declawed',
  dir: '/repos/zapac/declawed',
  relPath: 'declawed',
  version: '1.2.0',
  repo: { id: 'zapac', path: '/repos/zapac', name: 'zapac', isGit: true },
  workspacePath: '/repos/zapac/declawed-workspace',
}

const input = (over: Partial<EvalPromptInput> = {}): EvalPromptInput => ({
  skill: SKILL,
  evalAssets: [],
  hasSuite: false,
  install: {
    runner: '/tools/skill-up/bin/skill-up',
    pin: 'v0.7.0',
    authoringSkillDir: '/tools/skill-upper/repo/skills/skill-upper',
    missing: [],
  },
  ...over,
})

describe('buildEvalPrompt', () => {
  it('names where everything is, for a skill with no suite', () => {
    const body = buildEvalPrompt(input())

    expect(body).toContain('# Author the eval suite for declawed')
    expect(body).toContain('/repos/zapac/declawed`')
    expect(body).toContain('/repos/zapac/declawed/SKILL.md`')
    expect(body).toContain('- Declared version: 1.2.0')
    expect(body).toContain('/tools/skill-upper/repo/skills/skill-upper`')
    // Stated rather than omitted: a vanished line reads as a builder that
    // failed rather than as a skill that carries nothing.
    expect(body).toContain('none under `evals/`')
  })

  it('asks to extend rather than author when a suite is already there', () => {
    const body = buildEvalPrompt(
      input({ hasSuite: true, evalAssets: ['declawed/evals/eval.yaml', 'declawed/evals/cases'] }),
    )

    expect(body).toContain('# Extend the eval suite for declawed')
    expect(body).toContain('Extend `/repos/zapac/declawed/evals/eval.yaml`')
    expect(body).toContain('`declawed/evals/cases`')
  })

  it('tracks the manifest rather than a literal argv', () => {
    // §9.4's rule: a pin bump moves the prompt with it. A hand-written argv
    // would describe the previous release forever.
    const mutated: EvalPromptInput['lookup'] = (id) => {
      const real = getAdapter(id)
      if (!real || id !== 'skill-up') return real
      return {
        ...real,
        manifest: {
          ...real.manifest,
          invoke: { ...real.manifest.invoke, argv: ['run', '{skillDir}/suites/main.yaml', '--v2'] },
          artefacts: ['iteration-9/out.json'],
        },
      }
    }

    const body = buildEvalPrompt(input({ lookup: mutated }))

    expect(body).toContain('skill-up run /repos/zapac/declawed/suites/main.yaml --v2')
    expect(body).toContain('iteration-9/out.json')
  })

  it('carries the real adapter argv when nothing is injected', () => {
    const body = buildEvalPrompt(input())

    expect(body).toContain(
      'skill-up run /repos/zapac/declawed/evals/eval.yaml --format json --output-dir',
    )
    expect(body).toContain('iteration-1/report.json')
  })

  it('names a missing dependency above the task heading, never below it', () => {
    const body = buildEvalPrompt(
      input({ install: { ...input().install, missing: ['the `claude` CLI'] } }),
    )

    expect(body).toContain('> Missing: the `claude` CLI. Resolve these first.')
    // A prompt describing work that cannot start fails inside the agent's
    // session rather than in the terminal that produced it.
    expect(body.indexOf('> Missing:')).toBeLessThan(body.indexOf('## Task'))
  })

  it('binds the suite and the case layout, and says why each is fixed', () => {
    const body = buildEvalPrompt(input())

    expect(body).toContain('/repos/zapac/declawed/evals/eval.yaml` and nowhere else')
    expect(body).toContain("evaluate gate's argv names that exact path")
    expect(body).toContain('/repos/zapac/declawed/evals/cases/<case-id>.yaml')
    expect(body).toContain('naming a file that does not exist')
    expect(body).toContain('`v1alpha1`')
    expect(body).toContain('`rule_based`')
  })

  it('names credential keys and can carry no credential value — R7.3', () => {
    // The builder takes no credential argument at all, which is the structural
    // half of this: there is no path by which a value could reach the body.
    const body = buildEvalPrompt(input())

    expect(body).toContain('`ANTHROPIC_API_KEY`')
    expect(body).toContain('never write a key into a YAML file')
    expect(body).not.toMatch(/sk-[A-Za-z0-9]/)
  })

  it('forbids workspace writes and edits to the shipped skill', () => {
    const body = buildEvalPrompt(input())

    expect(body).toContain('`.skillgantry-workspace/`')
    expect(body).toContain('Do not edit anything the skill ships')
  })
})
