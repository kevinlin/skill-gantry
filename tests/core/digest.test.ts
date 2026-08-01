import { describe, expect, it } from 'vitest'
import { chmod, mkdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digestSkill } from '../../src/core/discovery/digest.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({ id: 'fx', path, name: 'fx', isGit: false })
const only = async (root: string) => (await discoverSkills(repoRef(root)))[0]!
const digestOf = async (root: string) => digestSkill(await only(root))

describe('digestSkill', () => {
  it('is stable across repeated calls', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    expect(await digestOf(root)).toBe(await digestOf(root))
  })

  it('changes when any byte of the skill changes', async () => {
    const root = await makeRepo({ files: { 'a/SKILL.md': SKILL_MD('a') } })
    const before = await digestOf(root)
    await writeFile(join(root, 'a/SKILL.md'), `${SKILL_MD('a')}\n`)
    expect(await digestOf(root)).not.toBe(before)
  })

  it('ignores the workspace directory so writing a run does not change it', async () => {
    const root = await makeRepo({ files: { 'SKILL.md': SKILL_MD('solo') } })
    const before = await digestOf(root)
    await mkdir(join(root, '.skillgantry-workspace/runs/x'), { recursive: true })
    await writeFile(join(root, '.skillgantry-workspace/runs/x/run.json'), '{}')
    expect(await digestOf(root)).toBe(before)
  })

  it('does change when a directory named snapshot-pre changes', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/snapshot-pre/notes.md': 'one\n' },
    })
    const before = await digestOf(root)
    await writeFile(join(root, 'a/snapshot-pre/notes.md'), 'two\n')
    expect(await digestOf(root)).not.toBe(before)
  })

  it('changes when the executable bit changes', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/scripts/run.sh': '#!/bin/sh\necho hi\n' },
    })
    const before = await digestOf(root)
    await chmod(join(root, 'a/scripts/run.sh'), 0o755)
    expect(await digestOf(root)).not.toBe(before)
  })

  it('changes when a symlink is retargeted, without reading either target', async () => {
    const root = await makeRepo({
      files: { 'a/SKILL.md': SKILL_MD('a'), 'a/one.md': 'x\n', 'a/two.md': 'x\n' },
    })
    await symlink('one.md', join(root, 'a/alias.md'))
    const before = await digestOf(root)
    await unlink(join(root, 'a/alias.md'))
    await symlink('two.md', join(root, 'a/alias.md'))
    expect(await digestOf(root)).not.toBe(before)
  })
})
