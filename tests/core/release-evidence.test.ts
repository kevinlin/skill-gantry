import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeEvidenceBundle } from '../../src/core/release/evidence.js'
import type { CandidateManifest } from '../../src/core/discovery/candidate.js'
import type { GateOutcome } from '../../src/core/ledger/gates.js'
import type { ToolLock } from '../../src/core/config/schema.js'

const manifest: CandidateManifest = {
  root: '/irrelevant',
  entries: [{ kind: 'file', relPath: 'SKILL.md', exec: false }],
  selfContained: true,
}

const lock: ToolLock = { version: 1, tools: {} }

async function scene() {
  const runDir = await mkdtemp(join(tmpdir(), 'sg-run-'))
  const sidecarPath = await mkdtemp(join(tmpdir(), 'sg-sidecar-'))
  return { runDir, sidecarPath }
}

const baseInput = {
  lock,
  skillDigest: 'sha256:deadbeef',
  manifest,
  archiveSha256: 'abc123',
  manifestMode: 'none' as const,
  targetVersion: '1.1.0',
}

describe('writeEvidenceBundle', () => {
  it('copies a live gate stage.json into the bundle', async () => {
    const { runDir, sidecarPath } = await scene()
    await mkdir(join(sidecarPath, '01-validate'), { recursive: true })
    await writeFile(join(sidecarPath, '01-validate', 'stage.json'), '{"stage":"validate"}\n')
    const gate: GateOutcome = {
      stage: 'validate',
      outcome: 'passed',
      skillDigest: 'sha256:deadbeef',
      runId: 'run-1',
      sidecarPath,
    }
    const dir = await writeEvidenceBundle({ ...baseInput, runDir, gates: [gate] })
    expect(await readFile(join(dir, 'validate.json'), 'utf8')).toBe('{"stage":"validate"}\n')
  })

  it('writes an unavailable placeholder when the run directory has been pruned', async () => {
    const { runDir, sidecarPath } = await scene()
    // No 01-validate/stage.json under sidecarPath: ENOENT, the pruned-run case.
    const gate: GateOutcome = {
      stage: 'validate',
      outcome: 'passed',
      skillDigest: 'sha256:deadbeef',
      runId: 'run-2',
      sidecarPath,
    }
    const dir = await writeEvidenceBundle({ ...baseInput, runDir, gates: [gate] })
    const placeholder = JSON.parse(await readFile(join(dir, 'validate.json'), 'utf8')) as {
      stage: string
      runId: string
      stageJson: string
    }
    expect(placeholder).toEqual({ stage: 'validate', runId: 'run-2', stageJson: 'unavailable' })
  })

  it('propagates a non-ENOENT copy failure instead of writing a placeholder', async () => {
    const { runDir, sidecarPath } = await scene()
    // A directory where stage.json should be: fails with something other than
    // ENOENT (EISDIR/ENOTSUP depending on platform), which must surface rather
    // than being swallowed into the same placeholder a pruned run gets.
    await mkdir(join(sidecarPath, '01-validate', 'stage.json'), { recursive: true })
    const gate: GateOutcome = {
      stage: 'validate',
      outcome: 'passed',
      skillDigest: 'sha256:deadbeef',
      runId: 'run-3',
      sidecarPath,
    }
    await expect(writeEvidenceBundle({ ...baseInput, runDir, gates: [gate] })).rejects.toThrow()
  })
})
