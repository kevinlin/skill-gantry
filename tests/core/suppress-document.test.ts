import { describe, expect, it } from 'vitest'
import type { BaselineSpec } from '../../src/core/adapters/types.js'
import { appendEntries } from '../../src/core/suppress/document.js'

const spec: BaselineSpec = {
  path: '{skillDir}/.skillspector-baseline.yaml',
  document: 'yaml',
  collection: 'rules',
  scaffold: { version: 2, rules: [], fingerprints: [] },
  entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
}

const rule = { id: 'MP2', path: 'scripts/scan.py', reason: 'alignment whitespace' }

describe('appendEntries', () => {
  it('takes the scaffold when the file is absent', () => {
    const { text, added } = appendEntries(null, spec, [rule])
    expect(added).toBe(1)
    expect(text).toContain('version: 2')
    expect(text).toContain('id: MP2')
    expect(text).toContain('path: scripts/scan.py')
  })

  // The user's own comments are the only record of why the earlier entries are
  // there. A rewrite that drops them is a silent edit of their file.
  it('preserves comments and key order on an existing document', () => {
    const current = [
      '# hand-written, do not regenerate',
      'version: 2',
      'scanner_version: "2.5.1"',
      'rules:',
      '  - id: SQP-1',
      '    reason: description nit',
      'fingerprints: []',
      '',
    ].join('\n')
    const { text } = appendEntries(current, spec, [rule])
    expect(text).toContain('# hand-written, do not regenerate')
    expect(text.indexOf('version: 2')).toBeLessThan(text.indexOf('rules:'))
    expect(text).toContain('id: SQP-1')
    expect(text).toContain('id: MP2')
  })

  // Bumping a v1 rule-only file to v2 retroactively applies v2's non-empty
  // reason rule to rules written before it existed, and can make a loadable
  // file unloadable.
  it('never touches version', () => {
    const { text } = appendEntries('version: 1\nrules: []\n', spec, [rule])
    expect(text).toContain('version: 1')
    expect(text).not.toContain('version: 2')
  })

  it('creates the collection when the document has no such key', () => {
    const { text, added } = appendEntries('version: 2\n', spec, [rule])
    expect(added).toBe(1)
    expect(text).toContain('rules:')
    expect(text).toContain('id: MP2')
  })

  it('appends several entries in one pass', () => {
    const second = { id: 'SSD-2', path: 'SKILL.md', reason: 'lab phrase' }
    const { text, added } = appendEntries(null, spec, [rule, second])
    expect(added).toBe(2)
    expect(text).toContain('id: MP2')
    expect(text).toContain('id: SSD-2')
  })

  // Without this, pressing `s` twice stacks duplicate rules in the user's repo
  // and nothing downstream notices.
  it('reports an identical entry as already present and adds nothing', () => {
    const once = appendEntries(null, spec, [rule])
    const twice = appendEntries(once.text, spec, [rule])
    expect(twice.added).toBe(0)
    expect(twice.alreadyPresent).toBe(1)
    expect(twice.text).toBe(once.text)
  })

  it('refuses a document that is not a mapping', () => {
    expect(() => appendEntries('- a\n- b\n', spec, [rule])).toThrow('baseline is not a mapping')
  })

  it('refuses a collection that is not a sequence', () => {
    expect(() => appendEntries('version: 2\nrules: {}\n', spec, [rule])).toThrow(
      'baseline `rules` is not a sequence',
    )
  })

  it('refuses a document that does not parse', () => {
    expect(() => appendEntries('a: [\n', spec, [rule])).toThrow(/baseline is not parseable/)
  })

  it('round-trips a json document', () => {
    const json: BaselineSpec = { ...spec, document: 'json' }
    const { text } = appendEntries('{"version":2,"rules":[]}', json, [rule])
    expect(JSON.parse(text)).toEqual({ version: 2, rules: [rule] })
  })
})
