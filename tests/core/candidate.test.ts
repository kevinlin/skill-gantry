import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { candidateManifest, materialiseCandidate } from '../../src/core/discovery/candidate.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })

const only = async (root: string) => (await discoverSkills(repoRef(root)))[0]!

describe('candidateManifest', () => {
  it('lists files sorted, with the exec bit', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/scripts/run.sh': '#!/bin/sh\n' },
    })
    const m = await candidateManifest(await only(root))
    expect(m.entries.map((e) => e.relPath)).toEqual(['SKILL.md', 'scripts/run.sh'])
    expect(m.selfContained).toBe(true)
  })

  it('excludes the exact workspace path but keeps a directory named snapshot-pre', async () => {
    const root = await makeRepo({
      files: {
        'a/SKILL.md': SKILL_MD('a'),
        'a/snapshot-pre/notes.md': 'a legitimate skill directory\n',
        'a-workspace/skillgantry/runs/x/run.json': '{}',
      },
    })
    const m = await candidateManifest(await only(root))
    expect(m.entries.map((e) => e.relPath)).toContain('snapshot-pre/notes.md')
    expect(m.entries.some((e) => e.relPath.includes('workspace'))).toBe(false)
  })

  it('marks a repo-root candidate not self-contained and drops its control files', async () => {
    const root = await makeRepo({
      files: { 'SKILL.md': SKILL_MD('solo'), '.gitignore': '*-workspace/\n' },
    })
    await mkdir(join(root, '.skillgantry-workspace'), { recursive: true })
    await writeFile(join(root, '.skillgantry-workspace/leak.json'), 'sk-secret\n')
    await writeFile(join(root, 'solo_1.0.0.zip'), 'PK')
    const m = await candidateManifest(await only(root))
    expect(m.selfContained).toBe(false)
    expect(m.entries.map((e) => e.relPath)).toEqual(['SKILL.md'])
  })

  it('records a symlink as a link and never reads its target', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a'), 'a/real.md': 'x\n' } })
    await symlink('real.md', join(root, 'a/alias.md'))
    const m = await candidateManifest(await only(root))
    expect(m.entries.find((e) => e.relPath === 'alias.md')).toEqual({
      kind: 'symlink',
      relPath: 'alias.md',
      target: 'real.md',
    })
  })

  it('rejects a symlink escaping the candidate root', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a'), 'outside.md': 'x\n' } })
    await symlink('../outside.md', join(root, 'a/escape.md'))
    await expect(candidateManifest(await only(root))).rejects.toThrow(/candidate-escapes-root/)
  })
})

describe('materialiseCandidate', () => {
  it('copies only manifest entries, preserving links and modes', async () => {
    const root = await makeRepo({
      files: { 'SKILL.md': SKILL_MD('solo'), 'scripts/run.sh': '#!/bin/sh\n' },
    })
    await mkdir(join(root, '.skillgantry-workspace'), { recursive: true })
    await writeFile(join(root, '.skillgantry-workspace/leak.json'), 'sk-canary\n')
    await symlink('scripts/run.sh', join(root, 'alias.sh'))

    const m = await candidateManifest(await only(root))
    const dest = await materialiseCandidate(m, await mkdtemp(join(tmpdir(), 'sg-cand-')))

    await expect(readFile(join(dest, 'SKILL.md'), 'utf8')).resolves.toContain('solo')
    expect(await readlink(join(dest, 'alias.sh'))).toBe('scripts/run.sh')
    await expect(readFile(join(dest, '.skillgantry-workspace/leak.json'))).rejects.toThrow()
  })
})
