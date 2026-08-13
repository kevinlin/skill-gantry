import { compareSemver } from '../release/version.js'
import { entriesAbove, parseChangelog } from './changelog.js'
import { loadUpgradeState, saveUpgradeState } from './state.js'
import type { ReleaseInfo, UpgradeCheck } from './types.js'

/**
 * R13.11. One hour, not a day: this window rate-limits the request *and* decides
 * how long a `latest: null` is believed, and at 24 hours the second meaning was
 * a bug — a release cut minutes after a check that correctly found nothing was
 * invisible to every launch until the next day. One request an hour is well
 * inside GitHub's unauthenticated 60/hour, and a machine behind a blocking
 * proxy now pays the 2s timeout hourly rather than daily.
 */
export const THROTTLE_MS = 60 * 60 * 1000
export const DEFAULT_REPO = 'kevinlin/skill-gantry'

const DEFAULT_API_BASE = 'https://api.github.com'
const DEFAULT_TIMEOUT_MS = 2000

export interface CheckOptions {
  home: string
  currentVersion: string
  /** Injected so the throttle is assertable without a fake clock. */
  now: number
  /** `upgrade` and `doctor` set this: an explicit command that answered from a
      cache, or honoured a decline, would be useless. */
  force?: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
  repo?: string
  apiBase?: string
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface LatestRelease {
  tag_name?: string
  published_at?: string
  html_url?: string
  assets?: ReleaseAsset[]
}

const assetUrl = (assets: readonly ReleaseAsset[], name: string): string => {
  const asset = assets.find((candidate) => candidate.name === name)
  if (!asset) throw new Error(`the release carries no ${name}`)
  return asset.browser_download_url
}

/**
 * The whole request, so any failure inside it — DNS, a 403 from the hourly
 * limit, a release missing an asset — reaches the caller as `unreachable`
 * rather than as a rejection. R13.11: this runs at launch and must not fail it.
 */
async function resolveLatest(options: CheckOptions): Promise<ReleaseInfo | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  const apiBase = options.apiBase ?? DEFAULT_API_BASE
  const repo = options.repo ?? DEFAULT_REPO
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // `releases/latest` excludes drafts and prereleases by construction, so there
  // is no client-side filter to keep in step with the publisher's.
  const res = await fetchImpl(`${apiBase}/repos/${repo}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`release lookup returned ${res.status}`)

  const body = (await res.json()) as LatestRelease
  const tag = body.tag_name
  if (!tag) throw new Error('the release carries no tag')
  const version = tag.startsWith('v') ? tag.slice(1) : tag

  const assets = body.assets ?? []
  const tarballUrl = assetUrl(assets, `skillgantry-${version}.tgz`)
  const sumsUrl = assetUrl(assets, 'SHA256SUMS')
  const changelogUrl = assetUrl(assets, 'CHANGELOG.md')

  // R13.9. The asset, not the branch: a branch has moved past the tag, and an
  // asset download does not count against the API's hourly limit.
  const changelog = await fetchImpl(changelogUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!changelog.ok) throw new Error(`changelog download returned ${changelog.status}`)

  return {
    version,
    publishedAt: body.published_at ?? '',
    tarballUrl,
    sumsUrl,
    releaseUrl: body.html_url ?? '',
    entries: entriesAbove(parseChangelog(await changelog.text()), options.currentVersion),
  }
}

/**
 * R13.11. State is written only on a request that succeeded: recording a failed
 * check as a check would buy an hour of silence for a request that never
 * happened.
 */
export async function checkForUpgrade(options: CheckOptions): Promise<UpgradeCheck> {
  const state = await loadUpgradeState(options.home)
  const fresh =
    state !== null &&
    Number.isFinite(Date.parse(state.lastCheckedAt)) &&
    options.now - Date.parse(state.lastCheckedAt) < THROTTLE_MS

  let latest: ReleaseInfo | null
  if (!options.force && fresh) {
    latest = state?.latest ?? null
  } else {
    let resolved: ReleaseInfo | null
    try {
      resolved = await resolveLatest(options)
    } catch (error) {
      return { kind: 'unreachable', reason: (error as Error).message }
    }
    // `null` is cached for "checked, nothing newer" as much as for "no release
    // at all": the throttled path reads this field and must not report a
    // version it would then have to compare all over again.
    latest =
      resolved && compareSemver(resolved.version, options.currentVersion) > 0 ? resolved : null
    await saveUpgradeState(options.home, {
      lastCheckedAt: new Date(options.now).toISOString(),
      declinedVersion: state?.declinedVersion ?? null,
      latest,
    })
  }

  if (!latest || compareSemver(latest.version, options.currentVersion) <= 0) {
    return { kind: 'current' }
  }
  // A decline is per version: a release above the declined one is a new offer.
  const declined = state?.declinedVersion
  if (!options.force && declined && compareSemver(latest.version, declined) <= 0) {
    return { kind: 'declined', release: latest }
  }
  return { kind: 'available', release: latest }
}
