import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseEvalReport } from '../../src/core/adapters/eval-report.js'

const load = (n: number): Promise<Buffer> =>
  readFile(`tests/fixtures/skill-up/declawed-iteration-${n}.report.json`)

const opts = { toolId: 'skill-up', skillRelPath: 'declawed' }

// `configuration` is omitempty in skill-up's report: JSON.stringify drops an
// undefined value, which is how a result with no field is built here.
const caseResult = (
  caseId: string,
  status: 'PASS' | 'FAIL' | 'ERROR',
  configuration?: string,
  turns = 1,
): Record<string, unknown> => ({
  case_id: caseId,
  title: `title of ${caseId}`,
  status,
  turns,
  configuration,
  grading: {
    assertion_results:
      status === 'PASS' ? [] : [{ text: 'asserts', passed: false, evidence: `evidence for ${caseId}` }],
  },
})

const report = (...results: Array<Record<string, unknown>>): Buffer =>
  Buffer.from(JSON.stringify({ schema_version: 'v1alpha1', case_results: results }))

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

  describe('benchmark reports, where each case appears once per configuration', () => {
    it('passes when the skill passes every case, whatever the baseline did', () => {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f']
      const bytes = report(
        ...ids.flatMap((id) => [
          caseResult(id, 'PASS', 'with_skill'),
          caseResult(id, 'FAIL', 'without_skill'),
        ]),
      )

      const parsed = parseEvalReport(bytes, opts)

      expect(parsed.outcome).toBe('passed')
      expect(parsed.findings).toEqual([])
      expect(parsed.metrics.casesTotal).toBe(6)
      expect(parsed.metrics.casesPassed).toBe(6)
      expect(parsed.summary).toBe('6/6 cases passed')
    })

    it('fails on a case the skill fails even though the baseline passed it', () => {
      const bytes = report(
        caseResult('regressed', 'FAIL', 'with_skill'),
        caseResult('regressed', 'PASS', 'without_skill'),
        caseResult('steady', 'PASS', 'with_skill'),
        caseResult('steady', 'FAIL', 'without_skill'),
      )

      const parsed = parseEvalReport(bytes, opts)

      expect(parsed.outcome).toBe('failed')
      expect(parsed.findings).toHaveLength(1)
      expect(parsed.findings[0]?.nativeRuleId).toBe('regressed')
      expect(parsed.findings[0]?.path).toBe('declawed/evals/cases/regressed.yaml')
    })

    it('sums turns over the with-skill results only and ignores a baseline error', () => {
      const bytes = report(
        caseResult('a', 'PASS', 'with_skill', 2),
        caseResult('a', 'ERROR', 'without_skill', 5),
        caseResult('b', 'PASS', 'with_skill', 2),
        caseResult('b', 'FAIL', 'without_skill', 5),
      )

      const parsed = parseEvalReport(bytes, opts)

      expect(parsed.metrics.turns).toBe(4)
      expect(parsed.metrics.casesErrored).toBe(0)
      expect(parsed.findings).toEqual([])
    })

    it('still gates on a result with no configuration or one it has not met', () => {
      const bytes = report(
        caseResult('bare', 'FAIL'),
        caseResult('variant', 'FAIL', 'old_skill'),
      )

      const parsed = parseEvalReport(bytes, opts)

      expect(parsed.outcome).toBe('failed')
      expect(parsed.findings.map((f) => f.nativeRuleId)).toEqual(['bare', 'variant'])
      expect(parsed.metrics.casesTotal).toBe(2)
    })
  })
})
