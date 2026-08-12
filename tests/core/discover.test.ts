import { describe, expect, it } from 'vitest'
import { basename, join } from 'node:path'
import { discoverSkills, workspacePath } from '../../src/core/discovery/discover.js'
import type { RepoRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'

const repoRef = (path: string): RepoRef => ({
  id: 'fx',
  path,
  name: basename(path),
  isGit: false,
})

describe('discoverSkills', () => {
  it('finds direct children holding SKILL.md', async () => {
    const root = await makeRepo({
      files: {
        'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0'),
        'spec-lint/SKILL.md': SKILL_MD('spec-lint'),
        'README.md': '# repo\n',
      },
    })
    const skills = await discoverSkills(repoRef(root))
    expect(skills.map((s) => s.id).sort()).toEqual(['fx/declawed', 'fx/spec-lint'])
    expect(skills.find((s) => s.id === 'fx/declawed')?.version).toBe('1.1.0')
  })

  it('skips workspace dirs, dotdirs and node_modules', async () => {
    const root = await makeRepo({
      files: {
        'declawed/SKILL.md': SKILL_MD('declawed'),
        'agent-insights-workspace/skill-snapshot/SKILL.md': SKILL_MD('snapshot'),
        '.hidden/SKILL.md': SKILL_MD('hidden'),
        'node_modules/pkg/SKILL.md': SKILL_MD('vendored'),
      },
    })
    const skills = await discoverSkills(repoRef(root))
    expect(skills.map((s) => s.id)).toEqual(['fx/declawed'])
  })

  it('treats a repo whose root holds SKILL.md as one skill', async () => {
    const root = await makeRepo({ files: { 'SKILL.md': SKILL_MD('solo') } })
    const skills = await discoverSkills(repoRef(root))
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ id: 'fx', relPath: '.', rootSkill: true })
    expect(skills[0]?.workspacePath).toBe(join(root, '.skillgantry-workspace'))
  })

  it('does not fail the scan on unreadable frontmatter', async () => {
    const root = await makeRepo({
      files: { 'broken/SKILL.md': '---\nname: [unclosed\n---\n', 'ok/SKILL.md': SKILL_MD('ok') },
    })
    const skills = await discoverSkills(repoRef(root))
    expect(skills).toHaveLength(2)
    expect(skills.find((s) => s.id === 'fx/broken')?.name).toBeNull()
  })

  // R2.5: tolerating it is not the same as saying nothing about it. Without the
  // flag, `name: null` reads the same whether the file failed or declared nothing.
  it('records which skills have frontmatter it could not read', async () => {
    const root = await makeRepo({
      files: {
        'broken/SKILL.md': '---\ndescription: use for work: creating a deck\n---\n',
        'ok/SKILL.md': SKILL_MD('ok'),
        'silent/SKILL.md': '# no frontmatter at all\n',
      },
    })
    const skills = await discoverSkills(repoRef(root))
    const readable = (id: string): boolean | undefined =>
      skills.find((s) => s.id === id)?.frontmatterReadable
    expect(readable('fx/broken')).toBe(false)
    expect(readable('fx/ok')).toBe(true)
    expect(readable('fx/silent')).toBe(true)
  })
})

describe('workspacePath', () => {
  it('uses a sibling directory for a nested skill', () => {
    expect(workspacePath('/r', 'declawed', false)).toBe('/r/declawed-workspace')
  })

  it('uses an in-repo dotdirectory for a repo-root skill', () => {
    expect(workspacePath('/r', '.', true)).toBe('/r/.skillgantry-workspace')
  })
})
