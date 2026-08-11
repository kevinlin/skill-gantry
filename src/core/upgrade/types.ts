/** One `## <version>` section of CHANGELOG.md. */
export interface ChangelogEntry {
  version: string
  lines: readonly string[]
}

/** A published release, resolved once and cached in `upgrade.json`. */
export interface ReleaseInfo {
  version: string
  publishedAt: string
  tarballUrl: string
  sumsUrl: string
  releaseUrl: string
  /** Already sliced to the entries above the version that was running at fetch
      time, so a throttled launch can render notes with no network call. */
  entries: readonly ChangelogEntry[]
}

export interface UpgradeState {
  lastCheckedAt: string
  declinedVersion: string | null
  /** `null` records "checked, nothing newer" — distinct from never checked. */
  latest: ReleaseInfo | null
}

export type UpgradeCheck =
  | { kind: 'current' }
  | { kind: 'declined'; release: ReleaseInfo }
  | { kind: 'unreachable'; reason: string }
  | { kind: 'available'; release: ReleaseInfo }

export type Eligibility =
  | { kind: 'owned'; link: string; target: string; versionsRoot: string }
  | { kind: 'foreign'; runningFrom: string; advice: string }
