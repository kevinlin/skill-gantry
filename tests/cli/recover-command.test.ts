import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { runRecover } from '../../src/cli/recover-command.js'
import { DEFAULT_CONFIG, registerRepo, saveConfig } from '../../src/core/config/config.js'
import { writeSandboxRecord } from '../../src/core/isolation/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'sg-home-'))
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  await saveConfig(home, DEFAULT_CONFIG)
  await registerRepo(home, repo)

  const ws = workspacePath(repo, 'sk', false)
  const recordDir = join(ws, 'skillgantry', 'runs', 'run-a')
  const snapshotDir = join(recordDir, 'snapshot-pre')
  await mkdir(join(snapshotDir, 'sk'), { recursive: true })
  await writeFile(join(snapshotDir, 'sk/SKILL.md'), SKILL_MD_FULL('sk'))
  await writeSandboxRecord(recordDir, {
    runId: 'run-a',
    stage: 'optimise',
    strategy: 'snapshot',
    state: 'active',
    scope: ['sk/SKILL.md'],
    repoPath: repo,
    skillId: `${join(repo).split('/').pop()}/sk`,
    snapshotDir,
    workRoot: repo,
    preimages: [{ path: 'sk/SKILL.md', sha256: 'stale', mode: 33188 }],
    openedAt: '2026-08-03T00:00:00.000Z',
  })
  await writeFile(join(repo, 'sk/SKILL.md'), 'half-written\n')

  const out: string[] = []
  const program = buildProgram({
    home,
    dbPath: join(home, 'gantry.db'),
    write: (line) => out.push(line),
  })
  return { home, repo, out, program }
}

describe('skillgantry recover', () => {
  it('lists an unresolved mutation and names the resolving flags', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover'])
    expect(out.join('\n')).toContain('run-a')
    expect(out.join('\n')).toContain('--restore run-a')
  })

  it('restores on --restore and reports the paths', async () => {
    const { repo, out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--restore', 'run-a'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe(SKILL_MD_FULL('sk'))
    expect(out.join('\n')).toContain('sk/SKILL.md')
  })

  it('does not claim the tree was never modified on an already-applied record', async () => {
    // A complete journal means the apply landed and the user approved it. The
    // message here used to be "the working tree was never modified", which is
    // false, on the one command a user reaches after a crash.
    const { repo, out, program } = await harness()
    const recordDir = join(workspacePath(repo, 'sk', false), 'skillgantry', 'runs', 'run-a')
    await writeFile(
      join(recordDir, 'journal.json'),
      JSON.stringify({
        runId: 'run-a',
        stage: 'optimise',
        liveRoot: repo,
        complete: true,
        entries: [{ path: 'sk/SKILL.md', priorSha: 'x', priorMode: 33188, priorBytesRef: 'aa' }],
      }),
    )
    await program.parseAsync(['node', 'skillgantry', 'recover', '--restore', 'run-a'])
    expect(out.join('\n')).not.toContain('never modified')
    expect(out.join('\n')).toContain('already completed')
    // And the applied bytes are still the applied bytes.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written\n')
  })

  it('leaves the tree alone on --forget', async () => {
    const { repo, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--forget', 'run-a'])
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written\n')
  })

  it('says so when nothing is unresolved', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--forget', 'run-a'])
    out.length = 0
    await program.parseAsync(['node', 'skillgantry', 'recover'])
    expect(out.join('\n')).toContain('no interrupted mutation')
  })

  it('emits one JSON document under --json', async () => {
    const { out, program } = await harness()
    await program.parseAsync(['node', 'skillgantry', 'recover', '--json'])
    expect(JSON.parse(out[0] as string)).toMatchObject([{ record: { runId: 'run-a' } }])
  })

  it('rejects --restore and --forget together rather than picking one', async () => {
    const { repo, program } = await harness()
    await expect(
      program
        .exitOverride()
        .parseAsync(['node', 'skillgantry', 'recover', '--restore', 'run-a', '--forget', 'run-a']),
    ).rejects.toThrow('pass either --restore or --forget, not both')
    // Neither action ran: the file is untouched.
    expect(await readFile(join(repo, 'sk/SKILL.md'), 'utf8')).toBe('half-written\n')
  })

  it('returns freshly-scanned state after --restore, not the pre-action snapshot', async () => {
    const { home, out } = await harness()
    const result = await runRecover({ home, dbPath: join(home, 'gantry.db'), write: (l) => out.push(l) }, {
      restore: 'run-a',
    })
    // The record `runRecover` just settled must not still read `active` in
    // the value handed back to a programmatic caller.
    expect(result).toEqual([])
  })
})
