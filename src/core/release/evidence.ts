import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolLock } from '../config/schema.js'
import type { CandidateManifest } from '../discovery/candidate.js'
import type { GateOutcome } from '../ledger/gates.js'

export interface EvidenceInput {
  /** `<run>` — the bundle lands at `<run>/evidence`. */
  runDir: string
  gates: readonly GateOutcome[]
  lock: ToolLock
  skillDigest: string
  manifest: CandidateManifest
  archiveSha256: string
  /** R9.5's manifest mode: which release path this run took. */
  manifestMode: 'versions.json' | 'none'
  targetVersion: string
}

const STAGE_DIR: Readonly<Record<string, string>> = {
  validate: '01-validate',
  evaluate: '02-evaluate',
  security: '03-security',
}

/**
 * R9.5. The bundle is a copy, not a reference: the gate runs it cites can be
 * pruned, and evidence that stops resolving is not evidence. It is deliberately
 * unredacted (R7.4a) — rewriting a tool's own report risks corrupting it — and
 * the workspace is mode 0700 and gitignored.
 */
export async function writeEvidenceBundle(input: EvidenceInput): Promise<string> {
  const dir = join(input.runDir, 'evidence')
  await mkdir(dir, { recursive: true })

  for (const gate of input.gates) {
    const source = join(gate.sidecarPath, STAGE_DIR[gate.stage] ?? gate.stage, 'stage.json')
    await copyFile(source, join(dir, `${gate.stage}.json`)).catch(async () => {
      // A pruned run directory is recorded as absent rather than failing the
      // release: the ledger row is still the evidence that the gate passed.
      await writeFile(
        join(dir, `${gate.stage}.json`),
        `${JSON.stringify({ stage: gate.stage, runId: gate.runId, stageJson: 'unavailable' }, null, 2)}\n`,
      )
    })
  }

  await writeFile(join(dir, 'tool-lock.json'), `${JSON.stringify(input.lock, null, 2)}\n`)
  await writeFile(
    join(dir, 'release.json'),
    `${JSON.stringify(
      {
        targetVersion: input.targetVersion,
        skillDigest: input.skillDigest,
        archiveSha256: `sha256:${input.archiveSha256}`,
        manifestMode: input.manifestMode,
        gates: input.gates,
        candidateManifest: input.manifest.entries,
      },
      null,
      2,
    )}\n`,
  )
  return dir
}
