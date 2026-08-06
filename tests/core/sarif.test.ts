import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSarif, rebasePath } from '../../src/core/adapters/sarif.js'

const sarif = (results: unknown[], rules: unknown[] = []): Buffer =>
  Buffer.from(
    JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'skillspector', version: '2.5.1', rules } }, results }],
    }),
  )

const result = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ruleId: 'LP3',
  message: { text: 'Skill has no declared permissions' },
  level: 'warning',
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'SKILL.md' }, region: { startLine: 1 } } },
  ],
  ...over,
})

describe('rebasePath', () => {
  it('prefixes a nested skill path', () => {
    expect(rebasePath('declawed', 'scripts/scan.py')).toBe('declawed/scripts/scan.py')
  })

  it('leaves a repo-root skill path alone', () => {
    expect(rebasePath('.', 'SKILL.md')).toBe('SKILL.md')
  })

  it('normalises a leading ./ and backslashes', () => {
    expect(rebasePath('declawed', './a\\b.py')).toBe('declawed/a/b.py')
  })
})

describe('parseSarif', () => {
  const opts = { toolId: 'skillspector', skillRelPath: 'declawed' }

  it('passes when there are no results', () => {
    const out = parseSarif(sarif([]), opts)
    expect(out.outcome).toBe('passed')
    expect(out.findings).toEqual([])
    expect(out.metrics.findingsTotal).toBe(0)
  })

  it('fails when results are present', () => {
    expect(parseSarif(sarif([result()]), opts).outcome).toBe('failed')
  })

  it('rebases the uri onto the skill path', () => {
    const [finding] = parseSarif(sarif([result()]), opts).findings
    expect(finding?.path).toBe('declawed/SKILL.md')
  })

  it('maps sarif levels onto severities', () => {
    const levels = ['error', 'warning', 'note', 'none']
    const out = parseSarif(sarif(levels.map((level) => result({ level }))), opts)
    expect(out.findings.map((f) => f.severity)).toEqual(['high', 'medium', 'low', 'info'])
  })

  it('defaults a missing level to medium', () => {
    const out = parseSarif(sarif([result({ level: undefined })]), opts)
    expect(out.findings[0]?.severity).toBe('medium')
  })

  it('classifies the rule and keeps the native id', () => {
    const [finding] = parseSarif(sarif([result()]), opts).findings
    expect(finding?.ruleClass).toBe('excessive-permission')
    expect(finding?.nativeRuleId).toBe('LP3')
  })

  it('degrades an unknown rule to a tool-scoped class', () => {
    const out = parseSarif(sarif([result({ ruleId: 'ZZ9' })]), opts)
    expect(out.findings[0]?.ruleClass).toBe('unmapped:skillspector:ZZ9')
  })

  it('keeps the line number as display metadata', () => {
    const out = parseSarif(sarif([result()]), opts)
    expect(out.findings[0]?.line).toBe(1)
  })

  it('handles a result with no location', () => {
    const out = parseSarif(sarif([result({ locations: undefined })]), opts)
    expect(out.findings[0]?.path).toBe('declawed')
    expect(out.findings[0]?.line).toBeUndefined()
  })

  it('handles a result with no ruleId', () => {
    const out = parseSarif(sarif([result({ ruleId: undefined })]), opts)
    expect(out.findings[0]?.nativeRuleId).toBe('unknown')
  })

  it('merges results across multiple runs', () => {
    const doc = Buffer.from(
      JSON.stringify({
        version: '2.1.0',
        runs: [
          { tool: { driver: { name: 't', version: '1' } }, results: [result()] },
          { tool: { driver: { name: 't', version: '1' } }, results: [result()] },
        ],
      }),
    )
    expect(parseSarif(doc, opts).findings).toHaveLength(2)
  })

  it('errors on malformed json rather than throwing', () => {
    const out = parseSarif(Buffer.from('{not json'), opts)
    expect(out.outcome).toBe('errored')
    expect(out.summary).toMatch(/could not be parsed/i)
  })

  it('errors when the document is not sarif-shaped', () => {
    expect(parseSarif(Buffer.from('{"hello":1}'), opts).outcome).toBe('errored')
  })
})

describe('parseSarif — result.suppressions (R4.15)', () => {
  const opts = { toolId: 'skillspector', skillRelPath: 'declawed' }
  const suppressed = (over: Record<string, unknown> = {}) => [
    { kind: 'external', justification: 'accepted false positive', ...over },
  ]

  it('annotates a suppressed result with the tool’s justification', () => {
    const out = parseSarif(sarif([result({ suppressions: suppressed() })]), opts)
    expect(out.findings[0]?.suppressed).toEqual({ justification: 'accepted false positive' })
  })

  it('treats an absent array and an empty one as unsuppressed — SARIF §3.27.23', () => {
    // Empty means "explicitly not suppressed", absent means "no information".
    // A truthiness test on the array conflates them; neither suppresses.
    expect(parseSarif(sarif([result()]), opts).findings[0]?.suppressed).toBeUndefined()
    expect(
      parseSarif(sarif([result({ suppressions: [] })]), opts).findings[0]?.suppressed,
    ).toBeUndefined()
  })

  it('ignores a suppression that has not taken effect', () => {
    for (const status of ['rejected', 'underReview']) {
      const out = parseSarif(sarif([result({ suppressions: suppressed({ status }) })]), opts)
      expect(out.findings[0]?.suppressed, status).toBeUndefined()
    }
  })

  it('defaults an absent status to accepted, which is what 2.5.1 emits', () => {
    const out = parseSarif(sarif([result({ suppressions: suppressed({ status: undefined }) })]), opts)
    expect(out.findings[0]?.suppressed).toBeDefined()
  })

  it('accepts a suppression carrying no justification', () => {
    const out = parseSarif(sarif([result({ suppressions: [{ kind: 'external' }] })]), opts)
    expect(out.findings[0]?.suppressed).toEqual({ justification: '' })
  })

  it('leaves the verdict and the count alone — §8.1 owns the gate', () => {
    const out = parseSarif(sarif([result({ suppressions: suppressed() })]), opts)
    expect(out.outcome).toBe('failed')
    expect(out.findings).toHaveLength(1)
    expect(out.metrics.findingsTotal).toBe(1)
  })

  it('names the suppressed count in the summary, and only when there is one', () => {
    const mixed = sarif([result({ suppressions: suppressed() }), result({ ruleId: 'MP2' })])
    expect(parseSarif(mixed, opts).summary).toBe('2 findings, 1 suppressed')
    expect(parseSarif(sarif([result()]), opts).summary).toBe('1 finding')
  })
})

describe('parseSarif — the captured baseline pair', () => {
  const opts = { toolId: 'skillspector', skillRelPath: 'declawed' }
  const load = async (name: string): Promise<Buffer> =>
    readFile(join(process.cwd(), 'tests/fixtures/sarif', name))

  it('differs from its unbaselined twin only in suppressions and findingId', async () => {
    // Captured back to back by scripts/capture-fixtures.sh at the pinned
    // version (R13.3), so anything else moving is upstream schema drift.
    const strip = (doc: Buffer): string =>
      JSON.stringify(
        JSON.parse(doc.toString('utf8')) as unknown,
        (key, value) => (key === 'suppressions' || key === 'findingId' ? undefined : value),
      )
    expect(strip(await load('skillspector-declawed-baselined.sarif'))).toBe(
      strip(await load('skillspector-declawed-unbaselined.sarif')),
    )
  })

  it('parses the real baselined capture as one suppressed finding', async () => {
    const out = parseSarif(await load('skillspector-declawed-baselined.sarif'), opts)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]?.nativeRuleId).toBe('MP2')
    expect(out.findings[0]?.suppressed?.justification).toMatch(/re\.VERBOSE/)
    expect(out.summary).toBe('1 finding, 1 suppressed')
  })

  it('parses its unbaselined twin as the same finding, unsuppressed', async () => {
    const out = parseSarif(await load('skillspector-declawed-unbaselined.sarif'), opts)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]?.suppressed).toBeUndefined()
    expect(out.outcome).toBe('failed')
  })
})
