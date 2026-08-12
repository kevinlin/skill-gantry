import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyInstallable } from '../../src/core/release/install-check.js'
import { packageCandidate } from '../../src/core/release/archive.js'
import { candidateManifest } from '../../src/core/discovery/candidate.js'
import { SKILL_MD_FULL, makeRepo } from '../helpers/tmp-repo.js'
import { repoSkillRef } from '../helpers/skill-ref.js'

/** Stands in for vercel `skills`: records its argv, cwd and env, then answers. */
async function fakeSkills(exitCode: number): Promise<{ bin: string; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
  const log = join(dir, 'invocation.txt')
  const bin = join(dir, 'skills')
  await writeFile(
    bin,
    [
      '#!/bin/sh',
      `{ echo "cwd=$PWD"; echo "track=$DO_NOT_TRACK"; echo "argv=$*"; } > ${JSON.stringify(log)}`,
      exitCode === 0
        ? 'echo Installed 1 skill'
        : 'echo "No valid skills found. Skills require a SKILL.md with name and description." >&2',
      `exit ${exitCode}`,
    ].join('\n'),
  )
  await chmod(bin, 0o755)
  return { bin, log }
}

async function archive() {
  const repo = await makeRepo({ files: { 'sk/SKILL.md': SKILL_MD_FULL('sk') } })
  const skill = repoSkillRef(repo)
  const stagingDir = await mkdtemp(join(tmpdir(), 'sg-stage-'))
  const packaged = await packageCandidate({
    manifest: await candidateManifest(skill),
    stagingDir,
    skillName: 'sk',
    version: '1.1.0',
  })
  return { packaged, stagingDir }
}

describe('verifyInstallable', () => {
  it('extracts the archive and installs that directory, in copy mode, non-interactively', async () => {
    const { packaged, stagingDir } = await archive()
    const { bin, log } = await fakeSkills(0)
    const result = await verifyInstallable({
      archivePath: packaged.archivePath,
      stagingDir,
      skillsBin: bin,
    })
    expect(result.ok).toBe(true)
    const invocation = await readFile(log, 'utf8')
    // R9.6: the same bytes a consumer receives, installed from a directory,
    // because vercel `skills` documents git sources and local directories and
    // not zip archives.
    expect(invocation).toContain('--copy')
    expect(invocation).toContain('-y')
    expect(invocation).toContain('--agent claude-code')
    // The isolated destination is the cwd, verified by probe: the tool writes
    // <cwd>/.claude/skills and <cwd>/skills-lock.json and nothing else.
    // realpath: the shell's $PWD resolves macOS's /tmp -> /private/tmp symlink,
    // which a plain string comparison against the mkdtemp path would not.
    expect(invocation).toContain(`cwd=${await realpath(result.destination)}`)
    // A gate must not emit an install telemetry event on the user's behalf.
    expect(invocation).toContain('track=1')
  })

  it('reports a non-zero exit as a failed gate, carrying the tool output', async () => {
    const { packaged, stagingDir } = await archive()
    const { bin } = await fakeSkills(1)
    const result = await verifyInstallable({
      archivePath: packaged.archivePath,
      stagingDir,
      skillsBin: bin,
    })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('No valid skills found')
  })

  it('installs the extracted tree, not the archive', async () => {
    const { packaged, stagingDir } = await archive()
    const { bin, log } = await fakeSkills(0)
    await verifyInstallable({ archivePath: packaged.archivePath, stagingDir, skillsBin: bin })
    const invocation = await readFile(log, 'utf8')
    expect(invocation).not.toContain('.zip')
  })

  it('reports a missing binary as errorKind spawn, distinct from the tool\'s own refusal', async () => {
    const { packaged, stagingDir } = await archive()
    const result = await verifyInstallable({
      archivePath: packaged.archivePath,
      stagingDir,
      skillsBin: join(stagingDir, 'does-not-exist'),
    })
    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('spawn')
    // A spawn failure is not the exit code of a process that never ran.
    expect(result.exitCode).toBeNull()
  })

  it('reports a timeout as errorKind timeout, distinct from a non-zero exit', async () => {
    const { packaged, stagingDir } = await archive()
    const dir = await mkdtemp(join(tmpdir(), 'sg-skills-'))
    const bin = join(dir, 'skills')
    await writeFile(bin, '#!/bin/sh\nsleep 5\n')
    await chmod(bin, 0o755)
    const result = await verifyInstallable({
      archivePath: packaged.archivePath,
      stagingDir,
      skillsBin: bin,
      timeoutMs: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('timeout')
  })
})
