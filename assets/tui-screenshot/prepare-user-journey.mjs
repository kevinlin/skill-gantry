import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  DEFAULT_CONFIG,
  loadConfig,
  registerRepo,
  saveConfig,
  saveToolLock,
} from '../../dist/core/config/config.js'

const exec = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'skillgantry-vhs-'))
const userHome = join(root, 'home')
const home = join(userHome, '.skillgantry')
const repo = join(root, 'skills')
const binDir = join(root, 'bin')
const fixtures = join(process.cwd(), 'tests', 'fixtures')

await mkdir(binDir, { recursive: true })

const skill = (name, description) => `---
name: ${name}
description: ${description}
metadata:
  version: 1.2.0
---

# ${name}

Use this skill when a maintainer needs ${description}.
`

const files = {
  '.gitignore': '*-workspace/\n.skillgantry-workspace/\n*.zip\n',
  'api-doc-writer/SKILL.md': skill('api-doc-writer', 'clear API reference documentation'),
  'code-review-expert/SKILL.md': skill(
    'code-review-expert',
    'a focused review of correctness, security, and maintainability',
  ),
  'code-review-expert/evals/eval.yaml': 'cases: evals/cases\n',
  'code-review-expert/evals/cases/review-edge-cases.yaml': 'id: review-edge-cases\n',
  'code-review-expert/scripts/analyse.py': 'print("review")\n',
  'release-notes/SKILL.md': skill('release-notes', 'concise release notes from a change set'),
}

for (const [relative, body] of Object.entries(files)) {
  const path = join(repo, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
}

await exec('git', ['init', '-q', '.'], { cwd: repo })
await exec('git', ['config', 'user.email', 'demo@example.invalid'], { cwd: repo })
await exec('git', ['config', 'user.name', 'SkillGantry demo'], { cwd: repo })
await exec('git', ['add', '-A'], { cwd: repo })
await exec('git', ['commit', '-qm', 'demo skills'], { cwd: repo })

const executable = async (name, body) => {
  const path = join(binDir, name)
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

const lint = await executable(
  'skill-lint',
  `cat "${join(fixtures, 'skill-lint', 'architecture-diagram.json')}"; exit 2`,
)
const evaluate = await executable(
  'skill-up',
  `mkdir -p "$6/iteration-1"
cp "${join(fixtures, 'skill-up', 'declawed-iteration-1.report.json')}" "$6/iteration-1/report.json"
exit 1`,
)
const security = await executable(
  'skillspector',
  `cp "${join(fixtures, 'sarif', 'skillspector-architecture-diagram.sarif')}" "$7"; exit 1`,
)
const release = await executable('skills', 'echo "Installed 1 skill"; exit 0')
const interpreter = await executable('python', 'exec python3 "$@"')

await registerRepo(home, repo)
const config = await loadConfig(home)
await saveConfig(home, {
  ...DEFAULT_CONFIG,
  repos: config.repos,
  stageTools: {
    validate: ['skill-lint'],
    evaluate: ['skill-up'],
    security: ['skillspector'],
    optimise: [],
  },
})

const installedAt = '2026-08-10T00:00:00Z'
const entry = (installKind, requestedPin, resolvedVersion, bin) => ({
  installKind,
  requestedPin,
  resolvedVersion,
  bin,
  integrity: 'n/a',
  installedAt,
  verifiedAt: installedAt,
})

await saveToolLock(home, {
  version: 1,
  tools: {
    'skill-lint': entry('npm-prefix', '0.2.0', '0.2.0', lint),
    'skill-up': entry('gh-release', 'v0.7.0', '0.7.0', evaluate),
    skillspector: entry('uv-tool', 'v2.5.1', '2.5.1', security),
    skills: entry('npm-prefix', '1.5.21', '1.5.21', release),
    skillhone: {
      ...entry(
        'git-skill',
        '7d565839fb4dc74f9c77f09ace660e1c0484e048',
        '7d565839fb4dc74f9c77f09ace660e1c0484e048',
        interpreter,
      ),
      links: [join(root, 'agent-skills', 'skillhone')],
    },
  },
})

process.stdout.write(userHome)
