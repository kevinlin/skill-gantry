import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline } from '../../src/core/pipeline/run.js'
import type { RunEvent } from '../../src/core/pipeline/events.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const SARIF = (results: unknown[]): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1' } }, results }],
  })

const FINDING = {
  ruleId: 'LP3',
  message: { text: 'no declared permissions' },
  level: 'warning',
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'SKILL.md' }, region: { startLine: 1 } } },
  ],
}

async function setup(sarifBody: string) {
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0') } })
  const repo = { id: 'fx', path: repoPath, name: 'fx', isGit: false }
  const [skill] = await discoverSkills(repo)
  const bin = await makeFakeTool('skillspector', `printf '%s' '${sarifBody}' > "$7"`)
  return {
    skill: skill!,
    ledger: openLedger(':memory:'),
    input: {
      skill: skill!,
      stages: ['security'] as const,
      trigger: 'cli',
      stageTools: { security: ['skillspector'] },
      lock: {
        version: 1 as const,
        tools: {
          skillspector: {
            installKind: 'uv-tool' as const,
            requestedPin: 'v2.5.1',
            resolvedVersion: '2.5.1',
            bin,
            integrity: 'n/a',
            installedAt: '2026-08-01T00:00:00Z',
            verifiedAt: '2026-08-01T00:00:00Z',
          },
        },
      },
      env: {},
      secrets: [],
      provenance: { baseUrlHost: null, models: {}, authTokenHash: null, analysisModes: {} },
      artefactSizeCapBytes: 1024 * 1024,
      timeoutOverridesMs: {},
    },
  }
}

const drain = async (events: AsyncIterable<RunEvent>): Promise<RunEvent[]> => {
  const seen: RunEvent[] = []
  for await (const event of events) seen.push(event)
  return seen
}

describe('runPipeline', () => {
  it('emits the full event sequence for a passing stage', async () => {
    const { ledger, input } = await setup(SARIF([]))
    const handle = runPipeline({ ...input, ledger })
    const events = await drain(handle.events)
    const summary = await handle.done
    expect(events.map((e) => e.type)).toEqual([
      'run:start',
      'stage:start',
      'tool:start',
      'tool:done',
      'stage:done',
      'run:done',
    ])
    expect(summary.outcome).toBe('passed')
    ledger.close()
  })

  it('writes run.json with the digest and provenance', async () => {
    const { ledger, input } = await setup(SARIF([]))
    const handle = runPipeline({ ...input, ledger })
    await drain(handle.events)
    const summary = await handle.done
    const doc = JSON.parse(await readFile(join(summary.runDir, 'run.json'), 'utf8'))
    expect(doc.skillDigest).toMatch(/^sha256:/)
    expect(doc.provenance).toBeDefined()
    expect(doc.toolLock.skillspector).toBe('2.5.1')
    ledger.close()
  })

  it('writes a per-tool artefact directory and one stage.json', async () => {
    const { ledger, input } = await setup(SARIF([FINDING]))
    const handle = runPipeline({ ...input, ledger })
    await drain(handle.events)
    const summary = await handle.done
    const stageDir = join(summary.runDir, '03-security')
    expect(JSON.parse(await readFile(join(stageDir, 'stage.json'), 'utf8')).outcome).toBe('failed')
    expect(
      (await readFile(join(stageDir, 'skillspector', 'findings.sarif'), 'utf8')).length,
    ).toBeGreaterThan(0)
    ledger.close()
  })

  it('records the run and the issue in the ledger', async () => {
    const { ledger, input } = await setup(SARIF([FINDING]))
    await drain(runPipeline({ ...input, ledger }).events)
    const runs = ledger.db.prepare('select count(*) as n from runs').get() as { n: number }
    const issues = ledger.db.prepare('select count(*) as n from issues').get() as { n: number }
    expect(runs.n).toBe(1)
    expect(issues.n).toBe(1)
    ledger.close()
  })

  it('appends to the index and moves latest', async () => {
    const { ledger, input, skill } = await setup(SARIF([]))
    await drain(runPipeline({ ...input, ledger }).events)
    const index = await readFile(join(skill.workspacePath, 'skillgantry/runs/index.ndjson'), 'utf8')
    expect(index.trim().split('\n')).toHaveLength(1)
    ledger.close()
  })

  it('adds the workspace patterns to the repo gitignore', async () => {
    const { ledger, input, skill } = await setup(SARIF([]))
    await drain(runPipeline({ ...input, ledger }).events)
    const body = await readFile(join(skill.repo.path, '.gitignore'), 'utf8')
    expect(body).toContain('*-workspace/')
    ledger.close()
  })

  it('halts the chain on a stage that does not pass', async () => {
    const { ledger, input } = await setup(SARIF([FINDING]))
    // `optimise` follows `security` in lifecycle order and is deliberately
    // given a security tool: planning it would throw, so reaching it at all
    // would surface as a run:error. Silence is the proof the chain halted.
    const handle = runPipeline({
      ...input,
      ledger,
      stages: ['security', 'optimise'] as const,
      stageTools: { security: ['skillspector'], optimise: ['skillspector'] },
    })
    const events = await drain(handle.events)
    expect(events.filter((e) => e.type === 'stage:start')).toHaveLength(1)
    expect(events.some((e) => e.type === 'run:error')).toBe(false)
    expect((await handle.done).outcome).toBe('failed')
    ledger.close()
  })

  it('leaves the digest unchanged after a run writes its artefacts', async () => {
    const { ledger, input } = await setup(SARIF([]))
    const first = runPipeline({ ...input, ledger })
    await drain(first.events)
    const a = (await first.done).skillDigest
    const second = runPipeline({ ...input, ledger })
    await drain(second.events)
    expect((await second.done).skillDigest).toBe(a)
    ledger.close()
  })

  it('changes the digest after the skill is edited', async () => {
    const { ledger, input, skill } = await setup(SARIF([]))
    const first = runPipeline({ ...input, ledger })
    await drain(first.events)
    await writeFile(join(skill.dir, 'SKILL.md'), `${SKILL_MD('declawed', '1.1.0')}\nextra\n`)
    const second = runPipeline({ ...input, ledger })
    await drain(second.events)
    expect((await second.done).skillDigest).not.toBe((await first.done).skillDigest)
    ledger.close()
  })
})
