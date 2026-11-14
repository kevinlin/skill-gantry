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
      input({
        hasSuite: true,
        evalAssets: ['declawed/evals/eval.yaml', 'declawed/evals/cases/ (3 files)'],
      }),
    )

    expect(body).toContain('# Extend the eval suite for declawed')
    expect(body).toContain('Extend `/repos/zapac/declawed/evals/eval.yaml`')
    expect(body).toContain('`declawed/evals/cases/ (3 files)`')
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
    // The gateway pair is the same credential in the shape `spawnEnv` derives
    // from, and the shape the setup wizard reports — naming only the API key
    // described a machine SkillGantry does not require.
    expect(body).toContain('`ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`')
    expect(body).toContain('never write a key into a YAML file')
    expect(body).not.toMatch(/sk-[A-Za-z0-9]/)
  })

  it('forbids workspace writes and edits to the shipped skill', () => {
    const body = buildEvalPrompt(input())

    expect(body).toContain('`.skillgantry-workspace/`')
    expect(body).toContain('Do not edit anything the skill ships')
  })
})

describe('R6.15 the eval prompt for an agent that drives the CLI', () => {
  const PREFIX =
    "You are working for the maintainer of this skill. SkillGantry's evaluate gate runs a skill's own eval suite, and "

  it('opens under the title by saying the gate cannot pass, and to write the suite', () => {
    const lines = buildEvalPrompt(input()).split('\n')

    expect(lines[0]).toBe('# Author the eval suite for declawed')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe(
      `${PREFIX}this skill has none, so that gate cannot pass. Your job is to write that suite. You are not fixing the skill.`,
    )
  })

  it('opens by saying the suite leaves behaviours uncovered, and to extend it', () => {
    const lines = buildEvalPrompt(input({ hasSuite: true })).split('\n')

    expect(lines[0]).toBe('# Extend the eval suite for declawed')
    expect(lines[2]).toBe(
      `${PREFIX}this skill has one, which may leave behaviours it claims untested. Your job is to extend that suite. You are not fixing the skill.`,
    )
  })

  it('forbids running the suite directly and says why', () => {
    const body = buildEvalPrompt(input())

    expect(body).toContain(
      '5. Stop and report what you wrote and what you deliberately left uncovered. Do not run the suite with `skill-up run` yourself: a run outside SkillGantry records nothing.',
    )
  })

  it('ends its constraints on what SkillGantry did not author, without citing an id', () => {
    const body = buildEvalPrompt(input())

    expect(body).toContain(
      '- SkillGantry has authored none of this. Everything here is yours to write.\n',
    )
  })

  it('closes with the shared Verify section for evaluate, then the digest warning', () => {
    const body = buildEvalPrompt(input())

    expect(body.endsWith(
      [
        '## Verify',
        '',
        '- Re-verify with `skillgantry run zapac/declawed --stage evaluate`. It exits 1 while any stage is not `passed`; that is a result, not an error.',
        '- `skillgantry status zapac/declawed` lists what still stands between this skill and a release.',
        "- Adding files under `evals/` changes the skill's digest, so `status` will report the other gates as stale until they are re-run.",
        '',
      ].join('\n'),
    )).toBe(true)
    // After Constraints, never before: it is the last thing the agent reads.
    expect(body.indexOf('## Constraints')).toBeLessThan(body.indexOf('## Verify'))
  })

  it('cites no requirement or decision id in the body', () => {
    for (const body of [
      buildEvalPrompt(input()),
      buildEvalPrompt(input({ hasSuite: true, evalAssets: ['declawed/evals/eval.yaml'] })),
      buildEvalPrompt(input({ install: { ...input().install, missing: ['the `claude` CLI'] } })),
    ]) {
      expect(body).not.toMatch(/\bR\d+\.\d+\b/)
      expect(body).not.toMatch(/\bD\d+\b/)
      expect(body).not.toContain('§')
    }
  })
})

describe('R6.13 the suite isolates its engine from the user’s own agent configuration', () => {
  const ISOLATION =
    "- Set `CLAUDE_CONFIG_DIR: .eval-claude-config` under `environment.env` in the suite, and add or correct it in an existing suite. Without it the `claude_code` engine loads the user's own agent configuration (their global CLAUDE.md, settings and installed skills), and the gate measures their setup instead of this skill. Keep the path relative: skill-up runs each case in a fresh temporary directory, so it resolves to an empty directory per case. The skill under test still loads, because skill-up installs it into the case's own `.claude/skills`. The engine then authenticates from the environment alone, because a `claude` login is stored in the directory this replaces. The credential has to reach it as `ANTHROPIC_API_KEY`, or as `ANTHROPIC_AUTH_TOKEN` with `ANTHROPIC_BASE_URL`."
  const CREDENTIAL = '- The engine is declared by the suite itself and authenticated by that CLI.'
  const AUTHORED_NONE = '- SkillGantry has authored none of this. Everything here is yours to write.'

  const modes: ReadonlyArray<[string, EvalPromptInput]> = [
    ['author', input({ hasSuite: false })],
    ['extend', input({ hasSuite: true, evalAssets: ['declawed/evals/eval.yaml'] })],
  ]

  it.each(modes)('renders the line, byte for byte and on one line, in %s mode', (_mode, given) => {
    const lines = buildEvalPrompt(given).split('\n')

    expect(lines).toContain(ISOLATION)
  })

  it.each(modes)('names the variable and where it goes, in %s mode', (_mode, given) => {
    const line = buildEvalPrompt(given)
      .split('\n')
      .find((l) => l.startsWith('- Set `CLAUDE_CONFIG_DIR'))

    // Both halves are load-bearing: the value is a relative path and the key
    // sits under `environment.env`, which is what skill-up lays over the host.
    expect(line).toContain('`CLAUDE_CONFIG_DIR: .eval-claude-config`')
    expect(line).toContain('`environment.env`')
    // An existing suite is corrected, not only a new one written with it.
    expect(line).toContain('add or correct it in an existing suite')
  })

  it.each(modes)('gives the reason: the user’s own configuration, in %s mode', (_mode, given) => {
    const body = buildEvalPrompt(given)

    expect(body).toContain("loads the user's own agent configuration")
    expect(body).toContain('the gate measures their setup instead of this skill')
    // Said so the agent does not read "empty directory" as "the skill is gone".
    expect(body).toContain('The skill under test still loads')
  })

  it.each(modes)('gives the auth consequence: a `claude` login, in %s mode', (_mode, given) => {
    const body = buildEvalPrompt(given)

    // The login lives in the directory this replaces, so a machine holding only
    // a login would otherwise meet this as an errored gate rather than a sentence.
    expect(body).toContain('a `claude` login is stored in the directory this replaces')
    expect(body).toContain('authenticates from the environment alone')
    expect(body).toContain('as `ANTHROPIC_API_KEY`, or as `ANTHROPIC_AUTH_TOKEN` with `ANTHROPIC_BASE_URL`')
  })

  it.each(modes)('sits right after the credential bullet, in %s mode', (_mode, given) => {
    const lines = buildEvalPrompt(given).split('\n')
    const at = lines.indexOf(ISOLATION)

    expect(at).toBeGreaterThan(0)
    expect(lines[at - 1]?.startsWith(CREDENTIAL)).toBe(true)
    expect(lines[at + 1]).toBe(AUTHORED_NONE)
  })

  it('adds no credential value and no id, so R7.3 and the id rule still hold', () => {
    const body = buildEvalPrompt(input())

    expect(body).not.toMatch(/sk-[A-Za-z0-9]/)
    expect(ISOLATION).not.toMatch(/\bR\d+\.\d+\b/)
    expect(ISOLATION).not.toContain('§')
  })
})
