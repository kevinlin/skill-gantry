import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { DEFAULT_CONFIG, registerRepo, saveConfig, saveToolLock } from '../../src/core/config/config.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { skillDigest } from '../../src/core/discovery/digest.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { Stage } from '../../src/core/types.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeGitRepo({
    files: {
      'sk/SKILL.md': SKILL_MD_FULL('sk'),
      'versions.json': '{\n  "skills": {\n    "sk": "1.0.0"\n  }\n}\n',
    },
  })
  await saveConfig(home, DEFAULT_CONFIG)
  const config = await registerRepo(home, repo)

  const skillsDir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
  const bin = join(skillsDir, 'skills')
  await writeFile(bin, '#!/bin/sh\necho "Installed 1 skill"\nexit 0\n')
  await chmod(bin, 0o755)
  await saveToolLock(home, {
    version: 1,
    tools: {
      skills: {
        installKind: 'npm-prefix',
        requestedPin: '1.5.21',
        resolvedVersion: '1.5.21',
        bin,
        integrity: 'n/a',
        installedAt: 'now',
        verifiedAt: 'now',
      },
    },
  })

  const dbPath = join(home, 'gantry.db')
  const [skill] = await discoverSkills(config.repos[0]!)
  const ledger = openLedger(dbPath)
  recordRun(ledger, {
    skill: skill!,
    runId: '019000000000-a',
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: await skillDigest(await candidateManifest(skill!)),
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: join(skill!.workspacePath, 'skillgantry', 'runs', '019000000000-a'),
    stages: (['validate', 'evaluate', 'security'] as Stage[]).map((stage) => ({
      stage,
      outcome: 'passed' as const,
      verdict: 'passed' as const,
      toolRuns: [],
    })),
  })
  ledger.close()

  const out: string[] = []
  return { home, repo, out, program: buildProgram({ home, dbPath, write: (l) => out.push(l) }) }
}

describe('skillgantry release', () => {
  it('emits the diff immediately before the write, and writes', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'minor', '--yes'])

    const text = out.join('\n')
    const diffAt = text.indexOf('+++ ')
    const appliedAt = text.indexOf('released')
    // R5.2's ordering holds in headless mode too: `--yes` is prior
    // authorisation, not permission to skip the diff.
    expect(diffAt).toBeGreaterThanOrEqual(0)
    expect(diffAt).toBeLessThan(appliedAt)
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.1.0')
    expect((await stat(join(repo, 'sk_1.1.0.zip'))).size).toBeGreaterThan(0)
    expect(program.exitCode).toBe(0)
  })

  it('skips and exits non-zero without --yes, writing nothing', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'minor'])
    expect(out.join('\n')).toContain('no-authorisation')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('1.0.0')
    await expect(stat(join(repo, 'sk_1.1.0.zip'))).rejects.toThrow()
    expect(program.exitCode).toBe(1)
  })

  it('reports every refusal and exits non-zero when a gate has not passed', async () => {
    const { repo, out, program } = await harness()
    await writeFile(join(repo, 'sk/SKILL.md'), SKILL_MD_FULL('sk', '1.0.0', 'edited after the gates'))
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'minor', '--yes', '--allow-dirty'])
    expect(out.join('\n')).toContain('R9.9')
    expect(program.exitCode).toBe(1)
  })

  it('refuses without --version rather than inferring one', async () => {
    const { program } = await harness()
    await expect(
      program.parseAsync(['node', 'sg', 'release', 'sk', '--yes']),
    ).rejects.toThrow(/version/)
  })

  it('emits newline-delimited JSON under --json', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'release', 'sk', '--version', 'patch', '--yes', '--json'])
    const types = out.map((line) => (JSON.parse(line) as { type: string }).type)
    expect(types).toContain('mutation:pending')
    expect(types).toContain('run:done')
  })
})
