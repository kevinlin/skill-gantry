import { describe, expect, it } from 'vitest'
import type { BaselineSpec } from '../../src/core/adapters/types.js'
import { globEscape, skillRelative, suppressionEntry } from '../../src/core/suppress/entry.js'

const spec: BaselineSpec = {
  path: '{skillDir}/.skillspector-baseline.yaml',
  document: 'yaml',
  collection: 'rules',
  scaffold: { version: 2, rules: [], fingerprints: [] },
  entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
}

describe('skillRelative', () => {
  // skillspector reports `scripts/scan.py`; RawFinding.path is
  // `declawed/scripts/scan.py`. The glob matches the tool's own path, so
  // writing the repo-relative one yields a rule that loads and matches nothing.
  it('strips the skill prefix from a repo-relative path', () => {
    expect(skillRelative('declawed/scripts/scan.py', 'declawed')).toBe('scripts/scan.py')
  })

  it('leaves a repo-root skill path alone', () => {
    expect(skillRelative('scripts/scan.py', '.')).toBe('scripts/scan.py')
  })

  it('leaves a path that does not carry the prefix alone', () => {
    expect(skillRelative('versions.json', 'declawed')).toBe('versions.json')
  })

  it('does not strip a sibling whose name merely starts the same way', () => {
    expect(skillRelative('declawed-notes/x.md', 'declawed')).toBe('declawed-notes/x.md')
  })
})

describe('globEscape', () => {
  it('leaves an ordinary path untouched', () => {
    expect(globEscape('scripts/scan.py')).toBe('scripts/scan.py')
  })

  // fnmatch treats these as metacharacters in the *pattern*, so an unescaped
  // `notes[1].md` is a character class and matches nothing on disk.
  it('escapes each fnmatch metacharacter as a single-member class', () => {
    expect(globEscape('notes[1].md')).toBe('notes[[]1].md')
    expect(globEscape('a*b')).toBe('a[*]b')
    expect(globEscape('a?b')).toBe('a[?]b')
  })
})

describe('suppressionEntry', () => {
  it('resolves every token in the declared entry', () => {
    expect(
      suppressionEntry(spec, {
        nativeRuleId: 'MP2',
        skillRelativePath: 'scripts/scan.py',
        reason: 'Alignment whitespace in a re.VERBOSE block',
      }),
    ).toEqual({
      id: 'MP2',
      path: 'scripts/scan.py',
      reason: 'Alignment whitespace in a re.VERBOSE block',
    })
  })

  it('escapes the glob-bound tokens and leaves the reason literal', () => {
    expect(
      suppressionEntry(spec, {
        nativeRuleId: 'MP2',
        skillRelativePath: 'notes[1].md',
        reason: 'accepted *as-is*',
      }),
    ).toEqual({ id: 'MP2', path: 'notes[[]1].md', reason: 'accepted *as-is*' })
  })

  it('throws on a token no vocabulary defines', () => {
    expect(() =>
      suppressionEntry(
        { ...spec, entry: { id: '{severity}' } },
        { nativeRuleId: 'MP2', skillRelativePath: 'a.md', reason: 'r' },
      ),
    ).toThrow('unknown suppression token: {severity}')
  })
})
