const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const BUMPS = ['major', 'minor', 'patch'] as const

interface Parsed {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

export function parseSemver(value: string): Parsed | null {
  const match = SEMVER.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/** A release is greater than a prerelease of the same numbers, per semver. */
function compare(a: Parsed, b: Parsed): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

/**
 * R9.10: explicit, never inferred. A bump level is still explicit — the user
 * named which component moves — but it needs a current version to move from.
 *
 * The greater-than check is not in R9, and it is here because release applies to
 * the user's repo and writes an archive named after the version: a mistyped
 * downgrade would publish evidence claiming the newer bytes are the older
 * release. It refuses rather than warns, because a refusal is reversible.
 */
export function resolveTargetVersion(current: string | null, spec: string): string {
  const parsedCurrent = current === null ? null : parseSemver(current)
  const trimmed = spec.trim()

  let target: string
  if ((BUMPS as readonly string[]).includes(trimmed)) {
    if (!parsedCurrent) {
      throw new Error(`no current version to bump: supply an explicit semver instead of ${trimmed}`)
    }
    const { major, minor, patch } = parsedCurrent
    // A bump means a release, so any prerelease on the current version is
    // dropped rather than carried forward or treated as already-there.
    target =
      trimmed === 'major'
        ? `${major + 1}.0.0`
        : trimmed === 'minor'
          ? `${major}.${minor + 1}.0`
          : `${major}.${minor}.${patch + 1}`
  } else {
    if (!parseSemver(trimmed)) {
      throw new Error(`${spec} is not a semver or a bump level (major, minor, patch)`)
    }
    target = trimmed
  }

  const parsedTarget = parseSemver(target) as Parsed
  if (parsedCurrent && compare(parsedTarget, parsedCurrent) <= 0) {
    throw new Error(`${target} is not greater than ${current}`)
  }
  return target
}
