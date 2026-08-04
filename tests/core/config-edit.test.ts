import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/core/config/config.js'
import {
  configChanges,
  withRepo,
  withScalar,
  withStageTools,
  withoutRepo,
} from '../../src/core/config/edit.js'

const base = { ...DEFAULT_CONFIG, repos: [] }

describe('withRepo', () => {
  it('derives the id from the directory name and records git-ness', () => {
    const next = withRepo(base, { path: '/tmp/zapac-agent-skills', isGit: true })
    expect(next.repos).toEqual([
      {
        id: 'zapac-agent-skills',
        path: '/tmp/zapac-agent-skills',
        name: 'zapac-agent-skills',
        isGit: true,
      },
    ])
  })

  it('deduplicates a colliding id with a numeric suffix', () => {
    const one = withRepo(base, { path: '/a/skills', isGit: false })
    const two = withRepo(one, { path: '/b/skills', isGit: false })
    expect(two.repos.map((r) => r.id)).toEqual(['skills', 'skills-2'])
  })

  it('rejects a path already registered, naming it', () => {
    const one = withRepo(base, { path: '/a/skills', isGit: false })
    expect(() => withRepo(one, { path: '/a/skills', isGit: false })).toThrow(
      'already registered: /a/skills',
    )
  })

  it('leaves the input untouched', () => {
    withRepo(base, { path: '/a/skills', isGit: false })
    expect(base.repos).toEqual([])
  })
})

describe('withoutRepo', () => {
  it('removes the named repo and nothing else', () => {
    const two = withRepo(withRepo(base, { path: '/a/x', isGit: false }), {
      path: '/b/y',
      isGit: false,
    })
    expect(withoutRepo(two, 'x').repos.map((r) => r.id)).toEqual(['y'])
  })

  it('is a no-op for an id that is not registered', () => {
    expect(withoutRepo(base, 'nope').repos).toEqual([])
  })
})

describe('withStageTools', () => {
  it('files each selected tool under its catalogue stage', () => {
    const next = withStageTools(base, ['skill-lint', 'skillspector'], () => true)
    expect(next.stageTools.validate).toEqual(['skill-lint'])
    expect(next.stageTools.security).toEqual(['skillspector'])
  })

  it('drops a tool the adapter registry does not know', () => {
    // R3.5b: a selection naming an unrunnable tool fails every run of that
    // stage, so it never reaches the config in the first place.
    const next = withStageTools(base, ['skill-lint', 'skills'], (id) => id !== 'skills')
    expect(Object.values(next.stageTools).flat()).toEqual(['skill-lint'])
  })
})

describe('withScalar', () => {
  it('parses and stores a whole number', () => {
    expect(withScalar(base, 'concurrency', '4').concurrency).toBe(4)
  })

  it('refuses a value the schema rejects, quoting the schema message', () => {
    expect(() => withScalar(base, 'concurrency', '99')).toThrow(/concurrency/)
  })

  it('refuses a value that is not a whole number', () => {
    expect(() => withScalar(base, 'concurrency', '2.5')).toThrow('not a whole number: 2.5')
  })

  it('stages a per-tool timeout override', () => {
    expect(withScalar(base, 'timeoutOverridesMs.skill-up', '900000').timeoutOverridesMs).toEqual({
      'skill-up': 900000,
    })
  })

  it('removes an override when the value is cleared', () => {
    const withOverride = withScalar(base, 'timeoutOverridesMs.skill-up', '900000')
    expect(withScalar(withOverride, 'timeoutOverridesMs.skill-up', '').timeoutOverridesMs).toEqual(
      {},
    )
  })
})

describe('configChanges', () => {
  it('reports nothing for an untouched config', () => {
    expect(configChanges(base, base)).toEqual([])
  })

  it('reports a scalar change with both values rendered', () => {
    expect(configChanges(base, withScalar(base, 'concurrency', '4'))).toEqual([
      { kind: 'change', path: 'concurrency', before: '2', after: '4' },
    ])
  })

  it('reports a repo addition by id and path', () => {
    expect(configChanges(base, withRepo(base, { path: '/a/skills', isGit: true }))).toEqual([
      { kind: 'add', path: 'repos[skills]', before: null, after: '/a/skills' },
    ])
  })

  it('reports a repo removal', () => {
    const one = withRepo(base, { path: '/a/skills', isGit: true })
    expect(configChanges(one, withoutRepo(one, 'skills'))).toEqual([
      { kind: 'remove', path: 'repos[skills]', before: '/a/skills', after: null },
    ])
  })

  it('reports a stage tool list as one row, not one row per tool', () => {
    const next = withStageTools(base, ['skill-lint', 'skillspector'], () => true)
    const validate = configChanges(base, next).find((c) => c.path === 'stageTools.validate')
    expect(validate).toEqual({
      kind: 'change',
      path: 'stageTools.validate',
      before: '(none)',
      after: 'skill-lint',
    })
  })

  it('reports an override added, changed and removed', () => {
    const added = withScalar(base, 'timeoutOverridesMs.skill-up', '900000')
    expect(configChanges(base, added)).toEqual([
      {
        kind: 'add',
        path: 'timeoutOverridesMs.skill-up',
        before: null,
        after: '900000',
      },
    ])
    expect(configChanges(added, base)).toEqual([
      {
        kind: 'remove',
        path: 'timeoutOverridesMs.skill-up',
        before: '900000',
        after: null,
      },
    ])
  })

  it('reports every changed field of a multi-field edit', () => {
    const next = withScalar(withRepo(base, { path: '/a/skills', isGit: true }), 'concurrency', '4')
    expect(configChanges(base, next).map((c) => c.path)).toEqual(['repos[skills]', 'concurrency'])
  })
})
