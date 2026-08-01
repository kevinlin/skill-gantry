import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { manifest } from '../../src/core/adapters/skillspector.js'

describe('design.md §7 example', () => {
  it('matches the shipped manifest on every field that can silently break a run', async () => {
    const doc = await readFile('docs/specs/design.md', 'utf8')
    const example = doc.slice(doc.indexOf("id: 'skillspector'"))
    expect(example).toContain(`pin: '${manifest.install.pin}'`)
    expect(example).toContain(`analysisMode: '${manifest.analysisMode}'`)
    expect(example).toContain('--no-llm')
    expect(example).toContain("credentials: { kind: 'none' }")
  })
})
