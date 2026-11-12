import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ToolLock } from '../config/schema.js'
import { type CandidateManifest, candidateManifest } from '../discovery/candidate.js'
import { skillDigest } from '../discovery/digest.js'
import { type GateOutcome, latestGateOutcomes } from '../ledger/gates.js'
import { RELEASE_TOOL_ID } from '../tools/catalogue.js'
import type { SkillRef } from '../types.js'
import { readVersionsManifest, type VersionsManifest } from './manifest.js'
import { type Refusal, type RefusalCode, checkPreconditions } from './preconditions.js'
import { manifestKeyFor } from './release.js'

/**
 * R9's codes plus the two refusals the release stage made outside
 * `checkPreconditions`: neither is a pure function of what `checkPreconditions`
 * takes, so neither belongs in its union, but a caller that reports blockers
 * has to be able to tell them apart.
 */
export type GatheredRefusalCode = RefusalCode | 'manifest-unreadable' | 'release-tool-missing'

export interface GatheredRefusal {
  code: GatheredRefusalCode
  message: string
}

/** What was read to decide, handed back so the stage does not read it twice. */
export interface ReleaseEvidence {
  /** null when the repo has no `versions.json`. */
  manifest: VersionsManifest | null
  candidate: CandidateManifest
  currentDigest: string
  gates: GateOutcome[]
}

export interface GatheredPreconditions {
  refusals: GatheredRefusal[]
  /** null only when `manifest-unreadable` returned before anything else was read. */
  evidence: ReleaseEvidence | null
}

export interface GatherInput {
  skill: SkillRef
  db: DatabaseSync
  lock: ToolLock
  /** R10.10: the caller scans, because this module opens no sandbox directory. */
  interrupted: boolean
}

const MANIFEST_UNREADABLE =
  'versions.json exists but could not be read as the expected {"skills": {...}} shape: ' +
  'fix or remove it before releasing (R9.2)'

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Every refusal a release would meet that does not need a target version, and
 * the evidence it read to decide. The one function both the release stage and
 * `status` call — a second assembly is how `status` would come to say ready
 * where `release` then refuses.
 *
 * A `versions.json` that exists but does not parse is closer to R9.2's "already
 * disagree" than to "no manifest": falling through to the SKILL.md-only path
 * would release a version the repo's own manifest, unreadably, might contradict.
 * It returns alone, as it always did, because nothing after it can be trusted
 * to describe the repo.
 */
export async function gatherReleasePreconditions(input: GatherInput): Promise<GatheredPreconditions> {
  const { skill } = input

  const manifest = await readVersionsManifest(skill.repo.path)
  if (manifest === null && (await pathExists(join(skill.repo.path, 'versions.json')))) {
    return { refusals: [{ code: 'manifest-unreadable', message: MANIFEST_UNREADABLE }], evidence: null }
  }

  const candidate = await candidateManifest(skill)
  const currentDigest = await skillDigest(candidate)
  const gates = latestGateOutcomes(input.db, skill.id)
  const refusals: Refusal[] = checkPreconditions({
    gates,
    currentDigest,
    // R1.6: the candidate's frontmatter, never the ledger.
    deprecated: skill.deprecated,
    frontmatterVersion: skill.version,
    manifestVersion: manifest?.versions[manifestKeyFor(skill)] ?? null,
    hasManifest: manifest !== null,
    interrupted: input.interrupted,
  })

  // First, because the stage meets it before it meets any of the others. The
  // stage reports the case as the skip it is; `status` has no run to skip.
  const missingTool: GatheredRefusal[] = input.lock.tools[RELEASE_TOOL_ID]
    ? []
    : [
        {
          code: 'release-tool-missing',
          message: `${RELEASE_TOOL_ID} is not installed: release cannot run its installability gate`,
        },
      ]

  return {
    refusals: [...missingTool, ...refusals],
    evidence: { manifest, candidate, currentDigest, gates },
  }
}
