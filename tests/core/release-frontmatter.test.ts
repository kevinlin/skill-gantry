import { describe, expect, it } from 'vitest'
import { setDeprecated, setFrontmatterVersion } from '../../src/core/release/frontmatter-edit.js'
import { parseFrontmatter } from '../../src/core/discovery/frontmatter.js'

const SOURCE = [
  '---',
  'name: sk',
  'description: does a thing',
  '# a comment the user wrote',
  'metadata:',
  '  version: 1.0.0',
  '  author: someone',
  '---',
  '',
  '# sk',
  '',
  'Body text with a --- sequence in it.',
  '',
].join('\n')

describe('setFrontmatterVersion', () => {
  it('replaces the version and changes nothing else', () => {
    const out = setFrontmatterVersion(SOURCE, '1.1.0')
    expect(parseFrontmatter(out).version).toBe('1.1.0')
    // Re-serialising the YAML would reorder keys and drop the comment — a
    // mutation the user did not ask for and would see in the diff.
    expect(out).toContain('# a comment the user wrote')
    expect(out).toContain('  author: someone')
    expect(out.split('\n').length).toBe(SOURCE.split('\n').length)
    expect(out).toContain('Body text with a --- sequence in it.')
  })

  it('inserts a version into a metadata block that has none', () => {
    const source = '---\nname: sk\nmetadata:\n  author: x\n---\n\n# sk\n'
    expect(parseFrontmatter(setFrontmatterVersion(source, '0.1.0')).version).toBe('0.1.0')
  })

  it('creates the metadata block when the frontmatter has none', () => {
    const source = '---\nname: sk\ndescription: d\n---\n\n# sk\n'
    const out = setFrontmatterVersion(source, '0.1.0')
    expect(parseFrontmatter(out).version).toBe('0.1.0')
    expect(parseFrontmatter(out).name).toBe('sk')
  })

  it('refuses a file with no frontmatter rather than inventing one', () => {
    expect(() => setFrontmatterVersion('# sk\n', '1.0.0')).toThrow('no frontmatter')
  })
})

describe('setDeprecated', () => {
  it('sets the flag and the supersession', () => {
    const out = setDeprecated(SOURCE, true, 'repo/other')
    expect(parseFrontmatter(out).deprecated).toBe(true)
    expect(out).toContain('superseded_by: repo/other')
    expect(parseFrontmatter(out).version).toBe('1.0.0')
  })

  it('clears the flag on reversal and removes the supersession', () => {
    const out = setDeprecated(setDeprecated(SOURCE, true, 'repo/other'), false)
    expect(parseFrontmatter(out).deprecated).toBe(false)
    expect(out).not.toContain('superseded_by')
  })
})
