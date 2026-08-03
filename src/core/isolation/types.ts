export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'mode-changed'

export interface ChangeEntry {
  /** Repo-relative, POSIX separators. */
  path: string
  kind: ChangeKind
  /** The former path, renames only. */
  from?: string
  /** The resulting mode, when it is part of the change. */
  mode?: number
  binary: boolean
}

export interface Preimage {
  /** Repo-relative. */
  path: string
  /** sha256 of the live bytes, or null when the path did not exist. */
  sha256: string | null
  /** Live mode, or null when the path did not exist. */
  mode: number | null
}

export interface ChangeSet {
  entries: ChangeEntry[]
  /** Text entries only. Binary ones stay in `entries` — that is R10.8. */
  unifiedDiff: string
  /**
   * What each target looked like when this change set was built. R10.11's
   * recheck compares against these, so they travel with the change set rather
   * than being re-derived at apply — re-deriving would compare the tree against
   * itself and never detect drift.
   */
  preimages: Preimage[]
}

export type SandboxStrategy = 'git-worktree' | 'snapshot'

export type SandboxState = 'active' | 'applied' | 'discarded'

/**
 * `SandboxRecord.stage` for retirement. Not a `Stage` — retirement is not one
 * of the five — so it is a literal, and recovery routes on it to pick the
 * `retire/` record group. One exported constant rather than the same string
 * typed twice: a typo on either side silently broke recovery routing, with
 * nothing failing.
 */
export const RETIRE_STAGE = 'retire'

/**
 * R10.10's marker. Written before any mutating tool starts, because the apply
 * journal only exists from apply onward: a crash during tool execution, or
 * while a diff sat awaiting approval, otherwise left a partially modified tree
 * with nothing on disk saying so.
 */
export interface SandboxRecord {
  runId: string
  stage: string
  strategy: SandboxStrategy
  state: SandboxState
  /** Repo-relative paths this mutation may write. */
  scope: string[]
  repoPath: string
  skillId: string
  /**
   * Repo-relative skill directory ('.' for a repo-root skill) and whether it is
   * one. Recovery has no live `SkillRef` — a record can outlive the run that
   * discovered it — and `restoreSnapshot` needs the candidate manifest to know
   * which live files the snapshot deliberately never captured. Without these
   * two fields it could only guess, and guessing meant deleting the repo's
   * `.gitignore` and any stale archive on a repo-root restore.
   */
  skillRelPath: string
  rootSkill: boolean
  /** Absolute; empty for the git strategy, which restores by pruning. */
  snapshotDir: string
  /** Absolute path to the sandbox work root, so recovery can prune it. */
  workRoot: string
  preimages: Preimage[]
  openedAt: string
}

export interface MutationSandbox {
  readonly strategy: SandboxStrategy
  /** Repo root inside the sandbox. For the snapshot strategy, the real repo. */
  readonly workRoot: string
  /** Absolute path of a repo-relative path inside the sandbox. */
  resolve(repoRelPath: string): string
  changeSet(): Promise<ChangeSet>
  /** Rechecks preimages, writes the journal, then moves bytes into the live tree. */
  apply(changeSet: ChangeSet): Promise<void>
  discard(): Promise<void>
  dispose(): Promise<void>
}
