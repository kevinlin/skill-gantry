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
    expect(parseFrontmatter(src)).toEqual({ name: 'declawed', version: '1.1.0', deprecated: false })
  })

  it('returns nulls when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({ name: null, version: null, deprecated: false })
  })

  it('returns nulls when the fields are absent', () => {
    expect(parseFrontmatter('---\ndescription: x\n---\n')).toEqual({ name: null, version: null, deprecated: false })
  })

  it('tolerates malformed yaml without throwing', () => {
    expect(parseFrontmatter('---\nname: [unclosed\n---\n')).toEqual({ name: null, version: null, deprecated: false })
  })

  it('coerces a numeric version to a string', () => {
    expect(parseFrontmatter('---\nmetadata:\n  version: 2\n---\n').version).toBe('2')
  })

  it('reads metadata.deprecated', () => {
    const src = '---\nname: x\nmetadata:\n  deprecated: true\n---\n'
    expect(parseFrontmatter(src)).toEqual({ name: 'x', version: null, deprecated: true })
  })

  it('accepts CRLF line endings', () => {
    expect(parseFrontmatter('---\r\nname: x\r\n---\r\n').name).toBe('x')
  })
})
