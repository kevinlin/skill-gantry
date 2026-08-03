import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import {
  DEFAULT_CONFIG,
  loadConfig,
  registerRepo,
  saveConfig,
  saveToolLock,
} from '../../src/core/config/config.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { readLifecycleCache } from '../../src/core/ledger/lifecycle.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { SKILL_MD_FULL, makeGitRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeGitRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  await saveConfig(home, DEFAULT_CONFIG)
  const config = await registerRepo(home, repo)
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
    skillDigest: 'sha256:x',
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: '/s',
    stages: [{ stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [] }],
  })
  ledger.close()
  const out: string[] = []
  return {
    home,
    repo,
    dbPath,
    out,
    skillId: skill!.id,
    program: buildProgram({ home, dbPath, write: (l) => out.push(l) }),
  }
}

describe('skillgantry retire', () => {
  it('prints the diff before the write and mirrors the ledger cache', async () => {
    const { repo, dbPath, out, skillId, program } = await harness()
    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--superseded-by', 'repo/other', '--yes'])
    const text = out.join('\n')
    expect(text.indexOf('deprecated: true')).toBeLessThan(text.indexOf('retired'))
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toContain('deprecated: true')

    const ledger = openLedger(dbPath)
    // §13: the file is the authority and the cache follows on the next scan.
    expect(readLifecycleCache(ledger.db).get(skillId)).toBe('deprecated')
    ledger.close()
    expect(program.exitCode).toBe(0)
  })

  it('writes nothing and exits non-zero without --yes', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'sg', 'retire', 'sk'])
    expect(out.join('\n')).toContain('needs --yes')
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).not.toContain('deprecated')
    expect(program.exitCode).toBe(1)
  })

  it('reverses with --undo', async () => {
    const { repo, program } = await harness()
    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--yes'])
    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--undo', '--yes'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).not.toContain('deprecated: true')
  })

  it('leaves the gates runnable against a deprecated skill', async () => {
    const { home, program, out } = await harness()
    // A validate stage that actually runs, rather than default config's empty
    // tool selection, so a pass here is evidence of R1.4 rather than an
    // artefact of the stage being skipped for want of a tool.
    const skillLintBin = await makeFakeTool(
      'skill-lint',
      `printf '%s' '{"schemaVersion":1,"skill":{"files":[]},"findings":[]}'`,
    )
    const config = await loadConfig(home)
    await saveConfig(home, { ...config, stageTools: { ...config.stageTools, validate: ['skill-lint'] } })
    await saveToolLock(home, {
      version: 1,
      tools: {
        'skill-lint': {
          installKind: 'npm-prefix',
          requestedPin: '0.2.0',
          resolvedVersion: '0.2.0',
          bin: skillLintBin,
          integrity: 'n/a',
          installedAt: '2026-08-01T00:00:00Z',
          verifiedAt: '2026-08-01T00:00:00Z',
        },
      },
    })

    await program.parseAsync(['node', 'sg', 'retire', 'sk', '--yes'])
    out.length = 0
    // R1.4: gates still run; only release refuses.
    await program.parseAsync(['node', 'sg', 'run', 'sk', '--stage', 'validate'])
    expect(out.join('\n')).not.toContain('deprecated')
    expect(program.exitCode).toBe(0)
  })
})
