import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runOptimise } from '../../src/cli/optimise-command.js'
import { makeCliFixture } from '../helpers/tmp-repo.js'

describe('skillgantry optimise', () => {
  it('prints a prompt and writes not one byte', async () => {
    const fixture = await makeCliFixture()
    const before = await readdir(fixture.runsRoot).catch(() => [])

    const code = await runOptimise(fixture.deps, 'declawed', {})

    expect(code).toBe(0)
    expect(fixture.out.join('\n')).toContain('# Optimise: declawed')
    // R11.10 and R12.6's shared constraint: the pipeline is the only writer
    // under runs/. A screen or a command that answers for a run must not
    // rewrite that run's evidence.
    expect(await readdir(fixture.runsRoot).catch(() => [])).toEqual(before)
  })

  it('exits non-zero and names the tool when SkillHone is not installed', async () => {
    const fixture = await makeCliFixture({ lockTools: [] })

    const code = await runOptimise(fixture.deps, 'declawed', {})

    expect(code).toBe(2)
    expect(fixture.out.join('\n')).toContain('skillgantry setup')
  })
})
