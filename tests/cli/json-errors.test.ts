import { describe, expect, it } from 'vitest'
import { runEvals } from '../../src/cli/evals-command.js'
import { runOptimise } from '../../src/cli/optimise-command.js'
import { makeCliFixture } from '../helpers/tmp-repo.js'

/**
 * R12.13: `2` already meant "the request could not be carried out" for these
 * two, and under `--json` they printed a sentence where a caller expects a
 * document. The code does not change; only the shape of the failure does.
 */
describe('a missing dependency under --json', () => {
  it('optimise prints {"error":{"message"}} and still exits 2', async () => {
    const fixture = await makeCliFixture({ lockTools: [] })

    const code = await runOptimise(fixture.deps, 'declawed', { json: true })

    expect(code).toBe(2)
    expect(fixture.out).toHaveLength(1)
    const doc = JSON.parse(fixture.out[0] as string) as { error: { message: string } }
    expect(Object.keys(doc)).toEqual(['error'])
    expect(Object.keys(doc.error)).toEqual(['message'])
    expect(doc.error.message).toContain('skillgantry setup')
  })

  it('evals prints {"error":{"message"}} and still exits 2', async () => {
    const fixture = await makeCliFixture({ lockTools: [] })

    const code = await runEvals(fixture.deps, 'declawed', { json: true }, fixture.userHome)

    expect(code).toBe(2)
    expect(fixture.out).toHaveLength(1)
    const doc = JSON.parse(fixture.out[0] as string) as { error: { message: string } }
    expect(Object.keys(doc)).toEqual(['error'])
    expect(doc.error.message).toContain('skillgantry setup')
  })

  it('keeps the prose line without --json', async () => {
    const fixture = await makeCliFixture({ lockTools: [] })
    expect(await runOptimise(fixture.deps, 'declawed', {})).toBe(2)
    expect(fixture.out.join('\n')).toContain('skillgantry setup')
    expect(() => JSON.parse(fixture.out.join('\n'))).toThrow()
  })
})
