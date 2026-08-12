import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../src/core/discovery/frontmatter.js'

describe('parseFrontmatter', () => {
  it('reads name and metadata.version', () => {
    const src = [
      '---',
      'name: declawed',
      'description: de-slop pass',
      'metadata:',
      '  version: 1.1.0',
      '---',
      '',
      '# Declawed',
    ].join('\n')
    expect(parseFrontmatter(src)).toEqual({
      name: 'declawed',
      version: '1.1.0',
      deprecated: false,
      supersededBy: null,
      readable: true,
    })
  })

  it('returns nulls when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({
      name: null,
      version: null,
      deprecated: false,
      supersededBy: null,
      readable: true,
    })
  })

  it('returns nulls when the fields are absent', () => {
    expect(parseFrontmatter('---\ndescription: x\n---\n')).toEqual({
      name: null,
      version: null,
      deprecated: false,
      supersededBy: null,
      readable: true,
    })
  })

  it('tolerates malformed yaml without throwing', () => {
    expect(parseFrontmatter('---\nname: [unclosed\n---\n')).toEqual({
      name: null,
      version: null,
      deprecated: false,
      supersededBy: null,
      readable: false,
    })
  })

  // R2.5. The distinction the flag exists for: a block that threw is not a file
  // that declared nothing, and only the first is worth reporting.
  it('marks a block it cannot read unreadable and a file with no block readable', () => {
    const unquoted = '---\ndescription: use for work: creating a deck\n---\n'
    expect(parseFrontmatter(unquoted).readable).toBe(false)
    expect(parseFrontmatter('---\njust a scalar\n---\n').readable).toBe(false)
    expect(parseFrontmatter('# no block at all\n').readable).toBe(true)
  })

  it('coerces a numeric version to a string', () => {
    expect(parseFrontmatter('---\nmetadata:\n  version: 2\n---\n').version).toBe('2')
  })

  it('reads metadata.deprecated', () => {
    const src = '---\nname: x\nmetadata:\n  deprecated: true\n---\n'
    expect(parseFrontmatter(src)).toEqual({
      name: 'x',
      version: null,
      deprecated: true,
      supersededBy: null,
      readable: true,
    })
  })

  it('reads metadata.superseded_by', () => {
    const src = '---\nname: x\nmetadata:\n  superseded_by: repo/other\n---\n'
    expect(parseFrontmatter(src).supersededBy).toBe('repo/other')
  })

  it('accepts CRLF line endings', () => {
    expect(parseFrontmatter('---\r\nname: x\r\n---\r\n').name).toBe('x')
  })
})
