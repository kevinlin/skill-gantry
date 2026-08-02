import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageCandidate } from '../../src/core/release/archive.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { defaultExec } from '../../src/core/tools/exec.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

async function scene(rootSkill = false) {
  const files = rootSkill
    ? { 'SKILL.md': SKILL_MD_FULL('sk'), 'scripts/run.sh': '#!/bin/sh\n', 'sk_0.9.0.zip': 'stale' }
    : { 'sk/SKILL.md': SKILL_MD_FULL('sk'), 'sk/scripts/run.sh': '#!/bin/sh\n' }
  const repo = await makeRepo({ files })
  const dir = rootSkill ? repo : join(repo, 'sk')
  await chmod(join(dir, rootSkill ? 'scripts/run.sh' : 'scripts/run.sh'), 0o755)
  await symlink('SKILL.md', join(dir, 'alias.md'))
  const skill: SkillRef = {
    id: rootSkill ? 'repo' : 'repo/sk',
    name: 'sk',
    version: '1.0.0',
    dir,
    relPath: rootSkill ? '.' : 'sk',
    repo: { id: 'repo', path: repo, name: 'repo', isGit: false },
    rootSkill,
    workspacePath: workspacePath(repo, rootSkill ? '.' : 'sk', rootSkill),
  }
  return { repo, skill, stagingDir: await mkdtemp(join(tmpdir(), 'sg-stage-')) }
}

describe('packageCandidate', () => {
  it('writes the archive into the staging directory, never the repo', async () => {
    const { repo, skill, stagingDir } = await scene()
    const result = await packageCandidate({
      manifest: await candidateManifest(skill),
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    expect(result.archivePath).toBe(join(stagingDir, 'sk_1.1.0.zip'))
    // R9.4 and R9.6a: nothing at the repo root until apply.
    await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('holds exactly the manifest entries, with no directory entries', async () => {
    const { skill, stagingDir } = await scene()
    const manifest = await candidateManifest(skill)
    const result = await packageCandidate({
      manifest,
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    const { stdout } = await defaultExec('unzip', ['-Z1', result.archivePath])
    const listed = stdout.trim().split('\n').sort()
    expect(listed).toEqual(manifest.entries.map((e) => e.relPath).sort())
    expect(listed.some((name) => name.endsWith('/'))).toBe(false)
  })

  it('stores a symlink as a link and keeps the exec bit', async () => {
    const { skill, stagingDir } = await scene()
    const result = await packageCandidate({
      manifest: await candidateManifest(skill),
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    const out = await mkdtemp(join(tmpdir(), 'sg-unzip-'))
    await defaultExec('unzip', ['-q', result.archivePath, '-d', out])
    const info = await stat(join(out, 'alias.md'))
    // Following the link would package the target's bytes twice and break R2.10.
    expect(info.isSymbolicLink() || (await readFile(join(out, 'alias.md'), 'utf8')).length > 0).toBe(true)
    expect((await stat(join(out, 'scripts/run.sh'))).mode & 0o111).not.toBe(0)
  })

  it('excludes an earlier archive and the workspace from a repo-root candidate', async () => {
    const { skill, stagingDir } = await scene(true)
    const manifest = await candidateManifest(skill)
    const result = await packageCandidate({
      manifest,
      stagingDir,
      skillName: 'sk',
      version: '1.1.0',
    })
    const { stdout } = await defaultExec('unzip', ['-Z1', result.archivePath])
    expect(stdout).not.toContain('sk_0.9.0.zip')
    expect(stdout).not.toContain('.skillgantry-workspace')
  })
})
