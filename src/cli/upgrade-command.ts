import {
  VERSION,
  applyUpgrade,
  checkForUpgrade,
  resolveEligibility,
  saveUpgradeState,
  type ApplyStep,
  type Exec,
  type ReleaseInfo,
} from '../core/index.js'
import { renderUpgrade } from '../tui/index.js'
import type { CliDeps } from './run-command.js'

/**
 * R12.10. Distinct codes per failure class, on `suppress`'s precedent: reusing
 * R12.2's meaning would make "already current" and "the lookup failed"
 * indistinguishable to a script.
 */
export const UPGRADE_EXIT = {
  ok: 0,
  available: 1,
  foreign: 2,
  unreachable: 3,
  integrity: 4,
  versionMismatch: 5,
  unauthorised: 6,
} as const

export interface UpgradeOptions {
  yes?: boolean
  json?: boolean
  check?: boolean
}

/**
 * The seams a test needs and production never passes, in `runEvals(…, userHome)`'s
 * shape: every field defaults to the real thing, so the subcommand's own call
 * site carries none of them.
 */
export interface UpgradeInjection {
  /** `process.argv[1]` — the link the shell resolved, not its target. */
  entryPath?: string
  currentVersion?: string
  now?: number
  fetchImpl?: typeof fetch
  exec?: Exec
  isTty?: boolean
  prompt?: typeof renderUpgrade
}

/** `install-cli.sh`'s register, which the user has already seen once. */
const progressLine = (step: ApplyStep, detail: string): string =>
  `${step.padEnd(15)}${detail}`

const jsonDocument = (current: string, release: ReleaseInfo | null): string =>
  JSON.stringify(
    {
      current,
      latest: release?.version ?? null,
      publishedAt: release?.publishedAt ?? null,
      releaseUrl: release?.releaseUrl ?? null,
      entries: release?.entries ?? [],
    },
    null,
    2,
  )

/**
 * R12.10. Checks regardless of throttle or decline, and **never relaunches** —
 * `upgrade` is a command, not a session, so re-execution belongs to the root
 * action alone.
 */
export async function runUpgrade(
  deps: CliDeps,
  options: UpgradeOptions,
  inject: UpgradeInjection = {},
): Promise<number> {
  const current = inject.currentVersion ?? VERSION
  const entryPath = inject.entryPath ?? process.argv[1] ?? ''
  const isTty = inject.isTty ?? process.stdout.isTTY === true
  const prompt = inject.prompt ?? renderUpgrade

  const check = await checkForUpgrade({
    home: deps.home,
    currentVersion: current,
    now: inject.now ?? Date.now(),
    force: true,
    ...(inject.fetchImpl === undefined ? {} : { fetchImpl: inject.fetchImpl }),
  })

  if (check.kind === 'unreachable') {
    deps.write(
      options.json === true
        ? jsonDocument(current, null)
        : `could not reach the release index: ${check.reason}`,
    )
    return UPGRADE_EXIT.unreachable
  }

  // `declined` cannot reach here — `force` suppresses it — but the union is
  // exhaustive by construction rather than by comment.
  if (check.kind === 'current' || check.kind === 'declined') {
    const release = check.kind === 'declined' ? check.release : null
    deps.write(
      options.json === true
        ? jsonDocument(current, release)
        : `skillgantry ${current} is current`,
    )
    return UPGRADE_EXIT.ok
  }

  const { release } = check
  if (options.json === true) deps.write(jsonDocument(current, release))
  else deps.write(`skillgantry ${current} -> ${release.version}`)

  if (options.check === true) return UPGRADE_EXIT.available

  // R13.10. Ownership is decided before anything is downloaded: an install we
  // did not make is reported, never replaced.
  const eligibility = await resolveEligibility(entryPath, deps.home)
  if (eligibility.kind === 'foreign') {
    deps.write(`running from ${eligibility.runningFrom}`)
    deps.write(eligibility.advice)
    return UPGRADE_EXIT.foreign
  }

  if (options.yes !== true) {
    if (!isTty) {
      // R12.4's rule for every mutating headless path.
      deps.write('re-run with --yes to install it')
      return UPGRADE_EXIT.unauthorised
    }
    const answer = await prompt({
      fromVersion: current,
      toVersion: release.version,
      publishedAt: release.publishedAt,
      entries: release.entries,
      installPath: `${deps.home}/versions/${release.version}`,
    })
    if (answer === 'skip') {
      await recordDecline(deps.home, release.version, inject.now ?? Date.now())
      return UPGRADE_EXIT.ok
    }
  }

  try {
    await applyUpgrade({
      release,
      home: deps.home,
      link: eligibility.link,
      fromVersion: current,
      ...(inject.fetchImpl === undefined ? {} : { fetchImpl: inject.fetchImpl }),
      ...(inject.exec === undefined ? {} : { exec: inject.exec }),
      onProgress: (step, detail) => deps.write(progressLine(step, detail)),
    })
  } catch (error) {
    const message = (error as Error).message
    deps.write(message)
    // The two verifications R13.12 requires get their own codes, because a
    // corrupt download and a tarball carrying the wrong release call for
    // different responses from whatever is driving this.
    if (/integrity mismatch|carries no entry/.test(message)) return UPGRADE_EXIT.integrity
    if (/reports/.test(message)) return UPGRADE_EXIT.versionMismatch
    return UPGRADE_EXIT.unreachable
  }

  deps.write(`skillgantry ${release.version} installed`)
  return UPGRADE_EXIT.ok
}

/**
 * R11.24. The decline sticks, and it is per version: a release above this one
 * is a new offer rather than the same one asked twice.
 */
export async function recordDecline(home: string, version: string, now: number): Promise<void> {
  await saveUpgradeState(home, {
    lastCheckedAt: new Date(now).toISOString(),
    declinedVersion: version,
    latest: null,
  })
}
