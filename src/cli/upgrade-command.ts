import { spawnSync } from 'node:child_process'
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

/**
 * The release index, overridable the way `GhReleaseOptions.apiBase` already is
 * and read here rather than in core, which owns no environment. The acceptance
 * suite points both at a local server; nothing else sets either.
 */
const releaseSource = (): { apiBase?: string; repo?: string } => ({
  ...(process.env['SG_UPGRADE_API_BASE'] === undefined
    ? {}
    : { apiBase: process.env['SG_UPGRADE_API_BASE'] }),
  ...(process.env['SG_UPGRADE_REPO'] === undefined
    ? {}
    : { repo: process.env['SG_UPGRADE_REPO'] }),
})

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
    ...releaseSource(),
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

/**
 * R11.24, R13.11. The launch-time offer: throttled, silent on failure, and it
 * never blocks or fails the launch. Everything it can answer other than a
 * completed relaunch is `'continue'`, so the root action's only branch is
 * whether to start the TUI at all.
 */
export async function maybeUpgrade(
  deps: CliDeps,
  inject: UpgradeInjection = {},
): Promise<'continue' | 'relaunched'> {
  // R13.12. Two independent guards stop a respawn loop: apply's post-install
  // version equality, and this. A loop in a TTY is not something a user can
  // easily escape, so neither guard is the only one.
  if (process.env['SG_UPGRADED_FROM']) return 'continue'

  const current = inject.currentVersion ?? VERSION
  const entryPath = inject.entryPath ?? process.argv[1] ?? ''
  const isTty = inject.isTty ?? process.stdout.isTTY === true
  const prompt = inject.prompt ?? renderUpgrade
  const now = inject.now ?? Date.now()

  const check = await checkForUpgrade({
    home: deps.home,
    currentVersion: current,
    now,
    ...releaseSource(),
    ...(inject.fetchImpl === undefined ? {} : { fetchImpl: inject.fetchImpl }),
  }).catch(() => ({ kind: 'unreachable' as const, reason: 'the check threw' }))

  // Silent on everything but an offer the user can act on: a launch the user
  // asked for is not the place to report that a lookup failed.
  if (check.kind !== 'available') return 'continue'
  const { release } = check

  const eligibility = await resolveEligibility(entryPath, deps.home)
  if (eligibility.kind === 'foreign') {
    // One line, not a prompt: this build cannot install itself, so an offer
    // would be an offer to do nothing. `doctor` and `skillgantry upgrade` keep
    // the detail reachable.
    deps.write(`skillgantry ${release.version} is available — ${eligibility.advice}`)
    return 'continue'
  }

  // Off a TTY there is nobody to answer, and R11.24's prompt is the only
  // authorisation this path has.
  if (!isTty) return 'continue'

  const answer = await prompt({
    fromVersion: current,
    toVersion: release.version,
    publishedAt: release.publishedAt,
    entries: release.entries,
    installPath: `${deps.home}/versions/${release.version}`,
  })
  if (answer === 'skip') {
    await recordDecline(deps.home, release.version, now)
    return 'continue'
  }

  let applied
  try {
    applied = await applyUpgrade({
      release,
      home: deps.home,
      link: eligibility.link,
      fromVersion: current,
      ...(inject.fetchImpl === undefined ? {} : { fetchImpl: inject.fetchImpl }),
      ...(inject.exec === undefined ? {} : { exec: inject.exec }),
      onProgress: (step, detail) => deps.write(progressLine(step, detail)),
    })
  } catch (error) {
    // R13.11 again: a failed upgrade leaves the installation byte-identical
    // and the launch unaffected, so this reports and continues.
    deps.write(`upgrade did not complete: ${(error as Error).message}`)
    return 'continue'
  }

  // `process.execPath` plus the new entry file rather than the PATH link: the
  // relaunch then depends on neither the rename having been observed nor the
  // shell's command hash.
  const result = spawnSync(process.execPath, [applied.entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, SG_UPGRADED_FROM: current },
  })
  process.exitCode = result.status ?? 0
  return 'relaunched'
}
