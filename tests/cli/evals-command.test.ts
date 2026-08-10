import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runEvals } from '../../src/cli/evals-command.js'
import { makeCliFixture, type CliFixture } from '../helpers/tmp-repo.js'

/** Everything R12.9's happy path needs: the runner locked, skill-upper held. */
const ready = (over: Parameters<typeof makeCliFixture>[0] = {}): Promise<CliFixture> =>
  makeCliFixture({ lockTools: ['skill-up'], runtimeSkills: ['skill-upper'], ...over })

/** Repo tree plus sidecar, so a byte moving anywhere shows up as a diff. */
async function snapshot(fixture: CliFixture): Promise<string> {
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await walk(path)))
      else out.push(`${path}\n${await readFile(path, 'utf8').catch(() => '<binary>')}`)
    }
    return out.sort()
  }
  return [...(await walk(fixture.repo)), ...(await walk(fixture.runsRoot))].join('\n---\n')
}

describe('skillgantry evals', () => {
  it('prints a prompt for a skill with no suite and writes not one byte', async () => {
    const fixture = await ready()
    const before = await snapshot(fixture)

    const code = await runEvals(fixture.deps, 'declawed', {}, fixture.userHome)

    expect(code).toBe(0)
    const body = fixture.out.join('\n')
    expect(body).toContain('# Author the eval suite for declawed')
    expect(body).toContain('skill-up run')
    // R11.10's and R12.6's shared constraint: the pipeline stays the only
    // writer under runs/, and nothing here touches the user's repo either.
    expect(await snapshot(fixture)).toBe(before)
  })

  it('offers to extend a suite the skill already carries', async () => {
    const fixture = await ready({ evalSuite: true })

    const code = await runEvals(fixture.deps, 'declawed', {}, fixture.userHome)

    expect(code).toBe(0)
    expect(fixture.out.join('\n')).toContain('# Extend the eval suite for declawed')
  })

  it('emits one document under --json', async () => {
    const fixture = await ready({ evalSuite: true })

    const code = await runEvals(fixture.deps, 'declawed', { json: true }, fixture.userHome)

    expect(code).toBe(0)
    const doc = JSON.parse(fixture.out.join('')) as {
      hasSuite: boolean
      prompt: string
      missing: string[]
    }
    expect(doc.hasSuite).toBe(true)
    expect(doc.prompt).toContain('# Extend the eval suite')
    expect(Array.isArray(doc.missing)).toBe(true)
  })

  it('exits non-zero naming the tool when skill-up is not locked', async () => {
    const fixture = await ready({ lockTools: [] })

    const code = await runEvals(fixture.deps, 'declawed', {}, fixture.userHome)

    // `fix`'s and `optimise`'s divergence from R12.2: the code answers "is
    // there a prompt on stdout", so this stays distinct from a clean skill.
    expect(code).toBe(2)
    expect(fixture.out.join('\n')).toContain('skill-up is not installed')
    expect(fixture.out.join('\n')).toContain('skillgantry setup')
  })

  it('exits non-zero naming skill-upper when no runtime holds it', async () => {
    const fixture = await ready({ runtimeSkills: [] })

    const code = await runEvals(fixture.deps, 'declawed', {}, fixture.userHome)

    expect(code).toBe(2)
    expect(fixture.out.join('\n')).toContain('skill-upper is not reachable')
    expect(fixture.out.join('\n')).toContain('skillgantry setup')
  })

  it('writes nothing on either refusal either', async () => {
    const fixture = await ready({ lockTools: [] })
    const before = await snapshot(fixture)

    await runEvals(fixture.deps, 'declawed', {}, fixture.userHome)

    expect(await snapshot(fixture)).toBe(before)
  })
})
