import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseEvalReport } from '../../src/core/adapters/eval-report.js'

const load = (n: number): Promise<Buffer> =>
  readFile(`tests/fixtures/skill-up/declawed-iteration-${n}.report.json`)

const opts = { toolId: 'skill-up', skillRelPath: 'declawed' }

describe('parseEvalReport', () => {
  it('turns each non-PASS case into one eval-failure finding pathed at its case file', async () => {
    const result = parseEvalReport(await load(1), opts)

    expect(result.outcome).toBe('failed')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.ruleClass).toBe('eval-failure')
    expect(result.findings[0]?.path).toBe(
      'declawed/evals/cases/report-scan-and-changelog.yaml',
    )
    expect(result.findings[0]?.nativeRuleId).toBe('report-scan-and-changelog')
  })

  it('passes when every case passed', async () => {
    const result = parseEvalReport(await load(3), opts)
    expect(result.outcome).toBe('passed')
    expect(result.findings).toEqual([])
  })

  it('reports case counts and turns, and no token metric', async () => {
    const result = parseEvalReport(await load(1), opts)
    expect(result.metrics.casesTotal).toBe(5)
    expect(result.metrics.casesPassed).toBe(4)
    expect(result.metrics.turns).toBeGreaterThan(0)
    // R1.5: the report carries input_tokens, output_tokens and total_tokens.
    // MetricKey has no key that could hold them, so they must not appear.
    expect(Object.keys(result.metrics).join(' ')).not.toMatch(/token|cost/i)
  })

  it('errors on a schema version it was not pinned to', () => {
    const other = Buffer.from(JSON.stringify({ schema_version: 'v1beta1', case_results: [] }))
    const result = parseEvalReport(other, opts)
    expect(result.outcome).toBe('errored')
    expect(result.summary).toMatch(/v1alpha1/)
  })

  it('errors on bytes that are not JSON', () => {
    expect(parseEvalReport(Buffer.from('not json'), opts).outcome).toBe('errored')
  })
})
