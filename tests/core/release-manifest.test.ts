import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readVersionsManifest, setManifestVersion } from '../../src/core/release/manifest.js'
import { makeRepo } from '../helpers/tmp-repo.js'

const REAL = '{\n  "skills": {\n    "architecture-diagram": "1.1.1",\n    "declawed": "1.1.0"\n  }\n}\n'

describe('versions.json', () => {
  it('reads the real shape: entries nested under a skills key', async () => {
    const repo = await makeRepo({ files: { 'versions.json': REAL } })
    const manifest = await readVersionsManifest(repo)
    expect(manifest?.path).toBe(join(repo, 'versions.json'))
    expect(manifest?.versions.declawed).toBe('1.1.0')
  })

  it('returns null when the repo has no manifest, which is the 54-skill case', async () => {
    expect(await readVersionsManifest(await makeRepo({ files: {} }))).toBeNull()
  })

  it('returns null for a manifest it cannot understand rather than guessing', async () => {
    const repo = await makeRepo({ files: { 'versions.json': '["a","b"]' } })
    expect(await readVersionsManifest(repo)).toBeNull()
  })

  it('edits one entry and preserves the rest of the file', () => {
    const out = setManifestVersion(REAL, 'declawed', '1.2.0')
    expect(JSON.parse(out)).toEqual({
      skills: { 'architecture-diagram': '1.1.1', declawed: '1.2.0' },
    })
    expect(out.endsWith('\n')).toBe(true)
  })

  it('refuses a key the manifest does not carry', () => {
    expect(() => setManifestVersion(REAL, 'absent', '1.0.0')).toThrow(
      'versions.json has no entry for absent',
    )
  })
})
