import { describe, expect, it } from 'vitest'
import { makeHeadless } from '../helpers/headless.js'

interface Event {
  type: string
  stages?: string[]
}

/**
 * R12.1 as amended: `--stage` was required, so the commonest request had the
 * longest spelling. The default is the three gates R9.8 reads, and never a
 * mutating stage — release needs a target and `--yes`.
 *
 * Asserted on `run:start`, which names the stages the run was asked for. The
 * chain halts at the first stage that does not pass, and this home locks no
 * tools, so the stages that actually executed say nothing about the request.
 */
describe('skillgantry run without --stage', () => {
  it('asks for validate, evaluate and security, in that order, and nothing else', async () => {
    const h = await makeHeadless()
    expect(await h.run(['run', 'sk', '--json'])).toBe(1)

    const start = h.out.map((line) => JSON.parse(line) as Event).find((e) => e.type === 'run:start')
    expect(start?.stages).toEqual(['validate', 'evaluate', 'security'])
    expect(h.err).toEqual([])
  })

  it('still honours an explicit --stage', async () => {
    const h = await makeHeadless()
    await h.run(['run', 'sk', '--stage', 'security', '--json'])

    const start = h.out.map((line) => JSON.parse(line) as Event).find((e) => e.type === 'run:start')
    expect(start?.stages).toEqual(['security'])
  })
})
