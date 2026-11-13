import { describe, expect, it } from 'vitest'
import { type GateStatus, type NextInput, nextSteps } from '../../src/cli/status-command.js'

const ID = 'repo/sk'

const gate = (
  stage: GateStatus['stage'],
  outcome: GateStatus['outcome'],
  over: Partial<GateStatus> = {},
): GateStatus => ({
  stage,
  outcome,
  runId: outcome === null ? null : `run-${stage}`,
  runDir: outcome === null ? null : `/ws/runs/run-${stage}`,
  current: outcome !== null,
  ...over,
})

/** A skill every branch is quiet for: three current passes and a suite. */
const READY: NextInput = {
  skillId: ID,
  interrupted: false,
  deprecated: false,
  hasEvalSuite: true,
  gates: [gate('validate', 'passed'), gate('evaluate', 'passed'), gate('security', 'passed')],
  blockers: [],
  dirty: [],
}

const commands = (input: NextInput): Array<string | null> =>
  nextSteps(input).map((step) => step.command)

describe('nextSteps', () => {
  it('names release as the one entry once nothing blocks it', () => {
    const steps = nextSteps(READY)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.command).toBe(`skillgantry release ${ID} --version <patch|minor|major> --yes`)
    expect(steps[0]?.why).not.toBe('')
  })

  it('carries the dirty paths on the ready entry, without making them a reason to stop', () => {
    const steps = nextSteps({ ...READY, dirty: ['sk/SKILL.md', 'versions.json'] })
    expect(steps).toHaveLength(1)
    expect(steps[0]?.command).toContain('release')
    expect(steps[0]?.why).toContain('sk/SKILL.md')
    expect(steps[0]?.why).toContain('versions.json')
    expect(steps[0]?.why).toContain('--allow-dirty')
  })

  it('names the version the target resolved to, in place of the bump levels', () => {
    const steps = nextSteps({ ...READY, releaseVersion: '1.1.0' })
    expect(steps).toHaveLength(1)
    expect(steps[0]?.command).toBe(`skillgantry release ${ID} --version 1.1.0 --yes`)
    expect(steps[0]?.command).not.toContain('<')
  })

  it('offers a skill that declares no version a semver to fill in, since a bump level has nothing to bump', () => {
    const steps = nextSteps({ ...READY, unversioned: true })
    expect(steps).toHaveLength(1)
    expect(steps[0]?.command).toBe(`skillgantry release ${ID} --version <semver> --yes`)
    expect(steps[0]?.command).not.toMatch(/patch|minor|major/)
    expect(steps[0]?.why).toMatch(/declares no version/)
    expect(steps[0]?.why).toMatch(/bump level has nothing to bump/)
    // The reason that the gates passed is still the first thing it says.
    expect(steps[0]?.why).toContain('every gate passed')
  })

  it('prefers the resolved version to the placeholder when a skill with no version was given a target', () => {
    const steps = nextSteps({ ...READY, unversioned: true, releaseVersion: '0.1.0' })
    expect(steps[0]?.command).toBe(`skillgantry release ${ID} --version 0.1.0 --yes`)
    expect(steps[0]?.why).not.toMatch(/bump level/)
  })

  it('carries dirty paths on a versioned entry the same way, with a resolved version', () => {
    const steps = nextSteps({ ...READY, releaseVersion: '1.0.1', dirty: ['sk_1.0.1.zip'] })
    expect(steps[0]?.command).toContain('--version 1.0.1')
    expect(steps[0]?.why).toContain('sk_1.0.1.zip')
  })

  it('does not mention uncommitted paths when there are none', () => {
    expect(nextSteps(READY)[0]?.why).not.toMatch(/uncommitted|allow-dirty/)
  })

  it('puts an interrupted mutation first and names recover', () => {
    const steps = nextSteps({
      ...READY,
      interrupted: true,
      blockers: [{ code: 'interrupted-mutation', message: 'an interrupted mutation is unresolved' }],
    })
    expect(steps[0]?.command).toBe('skillgantry recover')
    expect(steps[0]?.why).toContain('interrupted')
  })

  it('reports a version disagreement as an entry no command resolves', () => {
    const message = 'SKILL.md says 1.0.0 and versions.json says 0.9.0: reconcile them'
    const steps = nextSteps({
      ...READY,
      blockers: [{ code: 'version-disagreement', message }],
    })
    expect(steps).toEqual([{ command: null, why: message }])
  })

  it('reports a target that does not resolve as an entry no command resolves, since the version is the maintainer\'s to choose', () => {
    const message = '1.0.0 is not greater than 1.0.0'
    const steps = nextSteps({
      ...READY,
      blockers: [{ code: 'target-invalid', message }],
    })
    expect(steps).toEqual([{ command: null, why: message }])
  })

  it('names retire --undo for a deprecated skill', () => {
    const steps = nextSteps({
      ...READY,
      deprecated: true,
      blockers: [{ code: 'deprecated', message: 'the skill is deprecated' }],
    })
    expect(steps).toHaveLength(1)
    expect(steps[0]?.command).toBe(`skillgantry retire ${ID} --undo`)
  })

  it('names evals when the skill carries no eval suite', () => {
    const steps = nextSteps({
      ...READY,
      hasEvalSuite: false,
      gates: [gate('validate', 'passed'), gate('evaluate', null), gate('security', 'passed')],
      blockers: [{ code: 'gate-missing', message: 'evaluate has never run for this skill' }],
    })
    expect(steps[0]?.command).toBe(`skillgantry evals ${ID}`)
  })

  it('names one run --stage over every absent or stale gate, in gate order', () => {
    const steps = nextSteps({
      ...READY,
      gates: [
        gate('validate', null),
        gate('evaluate', 'passed'),
        gate('security', 'passed', { current: false }),
      ],
      blockers: [{ code: 'gate-missing', message: 'validate has never run for this skill' }],
    })
    expect(steps).toHaveLength(1)
    expect(steps[0]?.command).toBe(`skillgantry run ${ID} --stage validate,security`)
    expect(steps[0]?.why).toContain('validate')
    expect(steps[0]?.why).toContain('security')
  })

  it('treats a stale failure as stale, not as a finding to fix', () => {
    // The finding was about other bytes: fixing it first would be fixing
    // something that may already be gone.
    expect(
      commands({
        ...READY,
        gates: [
          gate('validate', 'failed', { current: false }),
          gate('evaluate', 'passed'),
          gate('security', 'passed'),
        ],
        blockers: [{ code: 'gate-not-passed', message: 'validate last reported failed' }],
      }),
    ).toEqual([`skillgantry run ${ID} --stage validate`])
  })

  it('names fix with the failing stage and the run that recorded it', () => {
    const steps = nextSteps({
      ...READY,
      gates: [
        gate('validate', 'failed', { runId: 'run-v' }),
        gate('evaluate', 'passed'),
        gate('security', 'failed', { runId: 'run-s' }),
      ],
      blockers: [
        { code: 'gate-not-passed', message: 'validate last reported failed' },
        { code: 'gate-not-passed', message: 'security last reported failed' },
      ],
    })
    // `--run` is load-bearing: the newest run need not have executed the stage.
    expect(steps.map((step) => step.command)).toEqual([
      `skillgantry fix ${ID} --stage validate --run run-v`,
      `skillgantry fix ${ID} --stage security --run run-s`,
    ])
  })

  it('names a re-run and doctor for a degraded gate, and never fix', () => {
    const steps = nextSteps({
      ...READY,
      gates: [
        gate('validate', 'passed'),
        gate('evaluate', 'degraded'),
        gate('security', 'passed'),
      ],
      blockers: [{ code: 'gate-not-passed', message: 'evaluate last reported degraded' }],
    })
    expect(steps.map((step) => step.command)).toEqual([
      `skillgantry run ${ID} --stage evaluate`,
      'skillgantry doctor',
    ])
    expect(steps[0]?.why).toMatch(/did not complete|not a finding/)
  })

  it('orders every branch as the spec does when they all apply', () => {
    const steps = nextSteps({
      skillId: ID,
      interrupted: true,
      deprecated: true,
      hasEvalSuite: false,
      gates: [
        gate('validate', null),
        gate('evaluate', 'failed', { runId: 'run-e' }),
        gate('security', 'degraded'),
      ],
      blockers: [
        { code: 'deprecated', message: 'deprecated' },
        { code: 'gate-missing', message: 'validate never ran' },
        { code: 'gate-not-passed', message: 'evaluate failed' },
        { code: 'gate-not-passed', message: 'security degraded' },
        { code: 'version-disagreement', message: 'versions disagree' },
        { code: 'interrupted-mutation', message: 'interrupted' },
      ],
      dirty: [],
    })
    expect(steps.map((step) => step.command)).toEqual([
      'skillgantry recover',
      null,
      `skillgantry retire ${ID} --undo`,
      `skillgantry evals ${ID}`,
      `skillgantry run ${ID} --stage validate`,
      `skillgantry fix ${ID} --stage evaluate --run run-e`,
      `skillgantry run ${ID} --stage security`,
      'skillgantry doctor',
    ])
    expect(steps.every((step) => step.why.length > 0)).toBe(true)
  })

  it('offers no release while any blocker stands', () => {
    const steps = nextSteps({
      ...READY,
      blockers: [{ code: 'release-tool-missing', message: 'skills is not installed' }],
    })
    expect(steps.some((step) => step.command?.includes('release'))).toBe(false)
  })
})

describe('nextSteps — a blocker no command clears still has an entry', () => {
  it('reports an unreadable versions.json as an entry no command resolves', () => {
    const message =
      'versions.json exists but could not be read as the expected {"skills": {...}} shape: fix or remove it before releasing (R9.2)'
    expect(
      nextSteps({ ...READY, blockers: [{ code: 'manifest-unreadable', message }] }),
    ).toEqual([{ command: null, why: message }])
  })

  it('reports a missing release tool as an entry no command resolves, and names both ways to install it', () => {
    const message = 'skills is not installed: release cannot run its installability gate'
    const steps = nextSteps({ ...READY, blockers: [{ code: 'release-tool-missing', message }] })

    expect(steps).toHaveLength(1)
    expect(steps[0]?.command).toBeNull()
    expect(steps[0]?.why).toContain(message)
    // `setup` is the one command that installs it: the reader has to learn that
    // the step is the maintainer's, not its own.
    expect(steps[0]?.why).toContain('maintainer')
    expect(steps[0]?.why).toContain('`skillgantry setup`')
    expect(steps[0]?.why).toContain('in a terminal')
    // R12.18: and that a preset reaches it without one. `command` stays null
    // above because a preset also rewrites the stage selection, so which one
    // is the maintainer's call.
    expect(steps[0]?.why).toContain('`skillgantry setup --yes --preset <name>`')
    expect(steps[0]?.why).toContain('stage selection')
    expect(steps[0]?.why).not.toContain('an agent cannot')
  })
})
