# M9 — Version check and self-upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** shipped.

**Goal:** Publish SkillGantry from GitHub Releases, and have the terminal interface offer — never impose — the newer release it finds at launch, installing it into a versioned prefix and relaunching into it.

**Architecture:** Four new modules under `src/core/upgrade/` do the deciding and the writing, with `fetchImpl` and `Exec` injected so the default suite never reaches the network. `src/cli/` owns every side effect the boundary denies the terminal — the spawn, the exit code, the progress lines — and `src/tui/upgrade-app.tsx` is presentation only: props in, one answer out. Nothing opens the ledger. The install is adopted by a single atomic rename over a symlink whose predecessor stays on disk, which is why this write path needs no marker and no journal.

**Tech Stack:** Node 24 (`fetch`, `AbortSignal.timeout`, `node:child_process`), GitHub Actions, `gh` CLI, npm as the installer, Ink 7 for the prompt, vitest.

## Specification

Layer 1: [requirements.md](requirements.md) — R13.8–R13.12, R11.24, R12.10, all new, plus a new **M9** row in § Milestone ownership.
Layer 2: [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md), reached from [design.md](design.md) §20. Amends design.md §5.3, §15, §17, §18 and [design_tui.md](design_tui.md) §14.14.
Decisions: **D30** and **D31**, appended to [decision-log.md](decision-log.md), which currently ends at D29.

## Global Constraints

Everything in [CLAUDE.md](../../CLAUDE.md) still holds. What shapes this change beyond it:

- **No new runtime dependency.** Global `fetch` rather than a client; `AbortSignal.timeout` rather than a timeout library; `compareSemver` extracted from [src/core/release/version.ts](src/core/release/version.ts) rather than the `semver` package. `dependencies` in `package.json` does not grow.
- **Node floor `>=24.0.0`**, ESM `NodeNext`, relative imports carry `.js`.
- **`src/core/**` has no `console` and no `process.exit`.** `apply` reports through an injected `onProgress` and throws; the CLI owns every line printed and every code returned.
- **`src/tui/**` may not spawn.** The prompt component returns an answer; `src/cli/` acts on it.
- **`fetchImpl` and `Exec` are injected**, defaulting to the real ones, exactly as [src/core/tools/gh-release.ts](src/core/tools/gh-release.ts) already does. `pnpm test` stays offline.
- **`tools/**`, `queue/**`, `isolation/**` must not open the ledger.** `upgrade/**` joins them: it never opens it either.
- **Exit codes are constants in one file.** `0` success or current, `1` upgrade available (`--check` only), `2` foreign install, `3` unreachable, `4` integrity mismatch, `5` post-install version mismatch, `6` authorisation withheld.
- **The repo is `kevinlin/skill-gantry`**, API base `https://api.github.com`, both overridable for tests the way `GhReleaseOptions.apiBase` already is.
- **`pnpm check` before every commit.**

## Task Order and Why

Specs first, per the repo's own precedence rule and because `tests/specs/traceability.test.ts` fails the build the moment a requirement has no milestone owner — so Task 1 is the one that makes every later task's requirement citation real.

`CHANGELOG.md` before `release.yml`, because the workflow asserts the file's shape and cannot be written against a format that does not exist yet. Both before any client code, so the client is built against a real published release rather than a hypothesised one.

Then the engine bottom-up — `compareSemver` and state, then the changelog parser, eligibility, the check, the apply — each independently testable with no network. `install-cli.sh` moves to the versioned layout immediately after `apply`, because the two must agree about the shape and the acceptance test in Task 15 drives both.

Surfaces last: the prompt, then the subcommand that can use it, then the root action that relaunches, then doctor. The acceptance test closes, because it is the only thing that proves the two properties a unit test cannot.

## Critical Files

| Path | Role |
|---|---|
| `CHANGELOG.md` | 14 backfilled entries; the source of the prompt's notes and the release body |
| `scripts/changelog-from-history.sh` | first-parent walk that derives the backfill; kept so it can be re-derived |
| `.github/workflows/release.yml` | two assertions, `pnpm check`, pack, checksums, `gh release create` |
| `scripts/install-cli.sh` | moved to `versions/<v>` plus an atomic relink |
| `src/core/release/version.ts` | `compare` exported as `compareSemver` |
| `src/core/upgrade/types.ts` | `ReleaseInfo`, `ChangelogEntry`, `UpgradeState`, `UpgradeCheck`, `Eligibility` |
| `src/core/upgrade/state.ts` | `upgrade.json` read and write |
| `src/core/upgrade/changelog.ts` | `parseChangelog`, `entriesAbove` |
| `src/core/upgrade/eligible.ts` | owned / foreign, from the entry path alone |
| `src/core/upgrade/check.ts` | `checkForUpgrade` — throttle, decline, silent failure |
| `src/core/upgrade/apply.ts` | the seven steps, `onProgress`, no-op on failure |
| `src/core/config/config.ts` | version-aware load errors for config and lock |
| `src/tui/upgrade-app.tsx` | the prompt; props in, answer out |
| `src/cli/upgrade-command.ts` | `runUpgrade`, `maybeUpgrade`, `UPGRADE_EXIT` |
| `src/cli/run-command.ts` | the `upgrade` subcommand and the root action's call |
| `src/cli/doctor-command.ts` | performs the check, passes it in as data |
| `src/core/tools/doctor.ts` | `DoctorReport.upgrade`, never touching `failed` |

---

## Tasks

### Task 1: Spec amendments and D30–D31

**Files:**
- Modify: `docs/specs/requirements.md` (R13 section, § Milestone ownership)
- Modify: `docs/specs/design.md` (§5.3, §15, §17, §18)
- Modify: `docs/specs/design_tui.md` (new §14.14)
- Modify: `docs/specs/decision-log.md` (append D30, D31)
- Modify: `docs/specs/index.md` (plan row)
- Test: `tests/specs/traceability.test.ts` (existing; must stay green)

**Interfaces:**
- Produces: requirement ids **R13.8–R13.12**, **R11.24**, **R12.10** and milestone **M9**, cited by every later task.

- [ ] **Step 1: Run the traceability test to confirm it is green before you touch anything**

```bash
pnpm vitest run tests/specs/traceability.test.ts
```
Expected: PASS. This is the baseline; if it is already red, stop and fix that first.

- [ ] **Step 2: Add the seven requirements to `requirements.md`**

Append to § R11, § R12 and § R13 respectively, in declaration order (the test expands ranges by declaration order, not numerically):

```markdown
- **R11.24** Where an upgrade is available and the running binary is one SkillGantry installed, the terminal interface MUST present it before the main screen mounts, naming the version it would install, the changelog entries above the running version, and the path it would install to. It MUST offer exactly two answers: install, or skip. Skipping MUST record that version as declined and MUST NOT prompt for it again. An interrupt MUST NOT be recorded as an answer. *(rev 25)*
  - *Rationale:* the prompt interrupts a launch the user asked for, so it must be answerable in one keystroke and must never be answerable by accident. A quit key at a prompt nobody requested exists only to be hit by mistake, and skipping already reaches the screen. A decline that does not stick turns the feature into a nag, which is how a prompt stops being read — `doctor` and `skillgantry upgrade` are the two surfaces that keep a declined version reachable.
  - *Verify:* a launch one version behind renders the entry for that version and installs nothing until `y`; `n` reaches the main screen and a second launch is silent; Ctrl+C at the prompt writes no state.

- **R12.10** `skillgantry upgrade` MUST check regardless of any throttle or recorded decline. `--check` MUST install nothing and MUST exit `0` when current and non-zero when an upgrade is available. Without prior authorisation on a non-interactive stream it MUST install nothing and exit non-zero. It MUST NOT relaunch. Failures MUST be separated by exit code into at least: a foreign install, an unreachable check, an integrity mismatch, a post-install version mismatch, and authorisation withheld. *(rev 25)*
  - *Rationale:* `fix` and `optimise` already diverge from R12.2's meaning for their exit codes, for the reason that applies here too — reusing it would make "already current" and "the lookup failed" indistinguishable to a script. Relaunching belongs to the root action alone, because `upgrade` is a command and not a session.

- **R13.8** A tagged release MUST NOT publish unless the tag equals the version in `package.json` and `CHANGELOG.md` carries a section for that version. A published release MUST carry the packed tarball, a SHA-256 checksum file covering it, and `CHANGELOG.md`, and its body MUST be that version's changelog section. *(rev 25)*
  - *Rationale:* a tag whose asset carries a different version makes the client loop — it installs, receives a version it did not ask for, and still sees the upgrade available. A missing changelog section makes the prompt render blank. Both are silent failures at the point of publication, where a refusal costs one re-tag.
- **R13.9** SkillGantry MUST maintain `CHANGELOG.md` with one section per released version, and the client MUST read it from the release's own asset rather than from a branch. *(rev 25)*
  - *Rationale:* a branch has usually moved past the tag, so reading from it shows entries for unreleased work; the asset is immutable and matched to its release. Asset downloads also do not count against the API's hourly limit.
- **R13.10** SkillGantry MUST install each version of itself into its own prefix under `<home>/versions/<version>`, and MUST adopt one only by an atomic rename over the command on PATH. The preceding version's prefix MUST be retained. SkillGantry MUST NOT upgrade a running binary it did not install; it MUST report what it found instead. *(rev 25)*
  - *Rationale:* a self-upgrade cannot delete the tree its own process was loaded from, which is what the flat prefix required. `ln -sfn` is unlink-then-symlink and leaves a window with no command on PATH; `rename` over a symlink is atomic. Retaining the predecessor is what makes rollback a rename rather than a reinstall. Refusing a foreign install is design.md §5.2's refuse-rather-than-clobber rule applied to our own binary, and it is what stops a development working tree being overwritten by the TUI running from it.
- **R13.11** The launch-time check MUST NOT block the launch and MUST NOT fail it. It MUST issue at most one network request per 24 hours, and a failed request MUST NOT count towards that interval. A version the user declined MUST NOT prompt again. *(rev 25)*
  - *Rationale:* §15's mutation-record scan sets the precedent that launch-time work never blocks. Recording a failed check as a check would buy 24 hours of silence for a request that never happened.
- **R13.12** An upgrade MUST verify the downloaded artefact against its published checksum, and MUST verify the installed binary reports the expected version, both before the rename that adopts it. A failure at any point before that rename MUST leave the installation byte-identical. `config.json` and `tools/lock.json` MUST be copied aside before the rename. A relaunch MUST NOT itself check for an upgrade. *(rev 25)*
  - *Rationale:* the ordering is the whole safety argument — nothing the running installation resolves through is touched until both verifications have passed, so there is no partially-updated state for a marker to describe and no journal is needed. Without the relaunch guard, a release whose packed version disagrees with its tag relaunches forever.
```

- [ ] **Step 3: Add the M9 row to § Milestone ownership**

```markdown
| M9 | R11.24, R12.10, R13.8–R13.12 | A tag whose version disagrees with the manifest, or whose changelog section is missing, fails to publish; a published release carries three assets and a body extracted from the changelog. A client one version behind prompts once per 24 hours, shows that version's changelog entry, and after `n` never prompts for it again while `doctor` still reports it. A corrupt tarball, an unreachable API and a post-install version mismatch each leave the installation byte-identical and the launch unaffected. A successful upgrade relinks atomically, retains exactly the previous prefix, snapshots `config.json` and `tools/lock.json` first, and relaunches into the new version without re-checking. A binary running from a development working tree reports the new version and refuses to upgrade itself |
```

- [ ] **Step 4: Run the traceability test — it must fail on design coverage, not on ownership**

```bash
pnpm vitest run tests/specs/traceability.test.ts
```
Expected: FAIL, naming the new ids as claimed by no design section. Ownership must already be satisfied; if it reports an id owned twice, a range or group token in another milestone's cell has swallowed it — `R13.1–R13.7` must not be written as the group token `R13`.

- [ ] **Step 5: Add the design.md §17 traceability rows and the §18 change-history row**

§17 gains rows mapping R11.24 → design_tui.md §14.14, R12.10 → §15, R13.8–R13.12 → §20. §18 gains:

```markdown
| M9 | Distribution became a thing the product does rather than a thing the maintainer does: a release contract with two pre-publish assertions, a changelog the client reads from the release's own asset, versioned install prefixes adopted by one atomic rename, and the launch-time offer that uses them (§20, §5.3, §15, §14.14) | [plan_m9-version-check-and-upgrade.md](plan_m9-version-check-and-upgrade.md) |
```

- [ ] **Step 6: Add §15's subcommand line and §5.3's doctor condition**

To §15's command block, after `skillgantry evals`:

```
skillgantry upgrade [--yes] [--json] [--check]
```

To §5.3's list of reporting-but-not-failing conditions, alongside `integrity-unverified` and `lifecycle-drift`: `skillgantry-outdated`, a published release newer than the running build, named with the command that installs it and never installed by `doctor` itself — R3.7's probe-and-report rule applied to SkillGantry's own binary.

- [ ] **Step 7: Add §14.14 to design_tui.md**

A new `### 14.14 The upgrade prompt` describing `UpgradeApp`, the two keys, the render without `alternateScreen`, and that it costs nothing from §14.1's row budget because it is not the main app. The plan said §14.13 and said not to renumber the duplicate `### 14.12` pair; a spec lint on `main` fixed that duplicate while this branch was in flight, so §14.13 is now the setup repo step and the prompt is §14.14 — see the deviation below.

- [ ] **Step 8: Append D30 and D31 to decision-log.md**

```markdown
## 14. SkillGantry distributes and upgrades itself

**D30. The channel is GitHub Releases, and a version is adopted by rename.**
CI publishes a packed tarball plus a checksum file and `CHANGELOG.md` against a `v*` tag. A client installs into `<home>/versions/<version>` and swings `~/.local/bin/skillgantry` onto it with one atomic rename.
*Why:* the npm name is unclaimed and the repo is already the distribution point, so releases cost no new account and no permanent public package. `gh-release.ts` established the download-and-verify shape, and `Integrity` already has a `sha256-asset` member for exactly this. The versioned prefix exists because the flat one cannot be replaced by the process running from it, and the rename exists because `ln -sfn` unlinks before it symlinks, leaving a window with no command on PATH.
*Rejected:* publishing to npm (claims the name permanently, and buys only the install step); cloning and building on the user's machine (a full toolchain and minutes per upgrade, for a package that packs in seconds).

**D31. The upgrade is offered at launch and adopted by relaunch, with no way to turn the offer off.**
The check runs before the main screen mounts, at most once per 24 hours, and never blocks or fails the launch. On confirmation the new version is installed, verified, adopted and re-executed with the same arguments.
*Why:* launch is the only moment in a session with no run in flight and no ledger open, which is what makes "install and relaunch" cheap and safe; mid-session it is neither. Two independent guards stop a respawn loop — the post-install version equality check, and `SG_UPGRADED_FROM` on the child.
*The cost, accepted:* a machine behind a blocking proxy pays the 2-second timeout once per 24 hours with no switch to flip. An opt-out was considered and dropped as a setting that would exist mainly to be found in a support thread.
*Rejected:* a background check after mount (interrupts a user already working, and relaunch is then unsafe); applying on exit (upgrades a session already finished, and a Ctrl+C silently drops the upgrade the user agreed to).
```

- [ ] **Step 9: Run the full traceability test and the spec lint**

```bash
pnpm vitest run tests/specs/traceability.test.ts
```
Expected: PASS.

- [ ] **Step 10: Add the plan row to index.md and commit**

```bash
git add docs/specs
git commit -m "docs(specs): specify the version check and self-upgrade (M9)"
```

---

### Task 2: `CHANGELOG.md` and the backfill script

**Files:**
- Create: `scripts/changelog-from-history.sh`
- Create: `CHANGELOG.md`

**Interfaces:**
- Produces: the file format Task 5 parses — `^## <semver>` opens an entry, body runs to the next `## ` or EOF.

- [ ] **Step 1: Write the script**

`scripts/changelog-from-history.sh`:

```bash
#!/usr/bin/env bash
# Derive CHANGELOG.md entries from git history.
#
# A version boundary is where `package.json`'s version differs from the
# previous commit's *along --first-parent*. Not `git log -- package.json`:
# that returns 0.5.0 older than 0.4.4, because 0.5.0 landed on a branch merged
# later, and it lists 0.4.4 at all — a version that never reached main's tip
# and was therefore never released.
#
# Usage: scripts/changelog-from-history.sh [ref]   (default: main)
set -euo pipefail

ref="${1:-main}"
prev_version=""
prev_commit=""

emit() {  # emit <version> <from-commit> <to-commit>
  local version="$1" from="$2" to="$3"
  local date range
  date="$(git log -1 --format=%ad --date=short "$to")"
  if [ -z "$from" ]; then range="$to"; else range="$from..$to"; fi
  printf '## %s — %s\n' "$version" "$date"
  git log "$range" --no-merges --format='%s' \
    | grep -E '^(feat|fix|ui|perf)[(: ]' \
    | sed 's/^/- /' || true
  printf '\n'
}

while read -r commit; do
  version="$(git show "$commit:package.json" 2>/dev/null \
    | node -p 'try{JSON.parse(require("fs").readFileSync(0,"utf8")).version}catch(e){""}' 2>/dev/null || true)"
  [ -n "$version" ] || continue
  if [ "$version" != "$prev_version" ]; then
    [ -z "$prev_version" ] || emit "$version" "$prev_commit" "$commit"
    prev_version="$version"
    prev_commit="$commit"
  fi
done < <(git log --first-parent --reverse --format=%H "$ref")
```

- [ ] **Step 2: Run it and check the boundaries against the known history**

```bash
chmod +x scripts/changelog-from-history.sh
scripts/changelog-from-history.sh main | grep '^## '
```
Expected: sections for 0.2.0 through 0.5.1 in ascending order. **0.4.4 must not appear** — it existed only on the branch merged as 0.5.0. If it does, the walk is not `--first-parent`.

- [ ] **Step 3: Compose `CHANGELOG.md`, newest first**

Header `# Changelog`, then the script's sections in **reverse** order (the script emits oldest-first; the file reads newest-first). Add a `## 0.1.0` section by hand for the initial range, which has no predecessor to diff against. Tighten wording where a subject is opaque out of context, but do not invent entries.

- [ ] **Step 4: Verify every released version has a section**

```bash
for v in 0.1.0 0.2.0 0.2.1 0.2.2 0.3.0 0.3.1 0.3.2 0.3.3 0.4.0 0.4.1 0.4.2 0.4.3 0.5.0 0.5.1; do
  grep -q "^## $v " CHANGELOG.md || echo "MISSING $v"
done
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md scripts/changelog-from-history.sh
git commit -m "docs: backfill CHANGELOG.md from first-parent history (R13.9)"
```

---

### Task 3: The release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 10
          cache: true

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24

      # R13.8. A tag whose asset carries a different version makes the client
      # loop: it installs, receives a version it did not ask for, and still
      # sees the upgrade available.
      - name: Tag matches the manifest
        run: |
          manifest="v$(node -p 'require("./package.json").version')"
          [ "$manifest" = "$GITHUB_REF_NAME" ] || {
            echo "tag $GITHUB_REF_NAME does not match package.json ($manifest)" >&2
            exit 1
          }

      # R13.8. A missing section makes the upgrade prompt render blank.
      - name: Changelog has a section for this version
        run: |
          version="${GITHUB_REF_NAME#v}"
          grep -q "^## $version " CHANGELOG.md || {
            echo "CHANGELOG.md has no '## $version' section" >&2
            exit 1
          }

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run checks
        run: pnpm check

      - name: Pack
        run: |
          mkdir -p release
          pnpm pack --pack-destination release

      - name: Checksums
        working-directory: release
        run: sha256sum ./*.tgz > SHA256SUMS

      - name: Release notes
        run: |
          version="${GITHUB_REF_NAME#v}"
          awk -v v="$version" '
            $0 ~ "^## " v " " { on = 1; next }
            on && /^## / { exit }
            on { print }
          ' CHANGELOG.md > release/NOTES.md
          cp CHANGELOG.md release/CHANGELOG.md

      - name: Publish
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --title "$GITHUB_REF_NAME" \
            --notes-file release/NOTES.md \
            release/*.tgz release/SHA256SUMS release/CHANGELOG.md
```

- [ ] **Step 2: Verify the two assertions and the notes extraction locally**

```bash
GITHUB_REF_NAME="v$(node -p 'require("./package.json").version')"
manifest="v$(node -p 'require("./package.json").version')"
[ "$manifest" = "$GITHUB_REF_NAME" ] && echo "tag assertion OK"
grep -q "^## ${GITHUB_REF_NAME#v} " CHANGELOG.md && echo "changelog assertion OK"
awk -v v="${GITHUB_REF_NAME#v}" '$0 ~ "^## " v " " {on=1;next} on && /^## / {exit} on {print}' CHANGELOG.md
```
Expected: both assertions print OK, and the awk prints exactly that version's bullets with no heading and no neighbouring section.

- [ ] **Step 3: Verify a wrong tag is refused**

```bash
GITHUB_REF_NAME=v9.9.9
grep -q "^## ${GITHUB_REF_NAME#v} " CHANGELOG.md || echo "correctly refused"
```
Expected: `correctly refused`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish a tagged release with checksums and changelog (R13.8)"
```

---

### Task 4: `compareSemver` and the upgrade state file

**Files:**
- Modify: `src/core/release/version.ts:33`
- Create: `src/core/upgrade/types.ts`
- Create: `src/core/upgrade/state.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/upgrade/state.test.ts`

**Interfaces:**
- Produces: `compareSemver(a: string, b: string): number` — negative, zero or positive; `-Infinity`-free, throwing on an unparseable input. `ChangelogEntry`, `ReleaseInfo`, `UpgradeState`, `UpgradeCheck`, `Eligibility`. `loadUpgradeState(home)`, `saveUpgradeState(home, state)`.

- [ ] **Step 1: Write the failing tests**

`tests/core/upgrade/state.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareSemver, loadUpgradeState, saveUpgradeState } from '../../../src/core/index.js'

describe('compareSemver', () => {
  it('orders by major, minor then patch', () => {
    expect(compareSemver('0.6.0', '0.5.1')).toBeGreaterThan(0)
    expect(compareSemver('0.5.1', '0.6.0')).toBeLessThan(0)
    expect(compareSemver('0.5.1', '0.5.1')).toBe(0)
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })

  it('ranks a release above a prerelease of the same numbers', () => {
    expect(compareSemver('0.6.0', '0.6.0-rc.1')).toBeGreaterThan(0)
  })

  it('throws on an unparseable version rather than sorting it', () => {
    expect(() => compareSemver('latest', '0.5.1')).toThrow(/latest/)
  })
})

describe('upgrade state', () => {
  it('reads back what it wrote', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-state-'))
    await saveUpgradeState(home, {
      lastCheckedAt: '2026-08-11T09:00:00.000Z',
      declinedVersion: '0.6.0',
      latest: null,
    })
    expect(await loadUpgradeState(home)).toEqual({
      lastCheckedAt: '2026-08-11T09:00:00.000Z',
      declinedVersion: '0.6.0',
      latest: null,
    })
    expect(await readFile(join(home, 'upgrade.json'), 'utf8')).toContain('declinedVersion')
  })

  it('returns null for an absent file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-state-'))
    expect(await loadUpgradeState(home)).toBeNull()
  })

  // A corrupt cache must never be the reason a launch fails: it is a cache.
  it('returns null for an unparseable file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-state-'))
    await saveUpgradeState(home, { lastCheckedAt: 'x', declinedVersion: null, latest: null })
    await (await import('node:fs/promises')).writeFile(join(home, 'upgrade.json'), '{ not json')
    expect(await loadUpgradeState(home)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/core/upgrade/state.test.ts
```
Expected: FAIL — no export named `compareSemver`.

- [ ] **Step 3: Export the comparator**

In `src/core/release/version.ts`, rename the private `compare` to `compareParsed`, keep its callers, and add:

```ts
/**
 * Exported for the upgrade check (§20), which asks the same question release
 * asks: is this version greater than that one. A second comparator is how the
 * two come to disagree about what "newer" means — the prerelease rule above is
 * exactly the part a hand-rolled second copy gets wrong.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left) throw new Error(`${a} is not a semver`)
  if (!right) throw new Error(`${b} is not a semver`)
  return compareParsed(left, right)
}
```

- [ ] **Step 4: Write `src/core/upgrade/types.ts`**

```ts
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
```

- [ ] **Step 5: Write `src/core/upgrade/state.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpgradeState } from './types.js'

const stateFile = (home: string): string => join(home, 'upgrade.json')

/**
 * `null` for absent *and* for unparseable. This file is a cache: a corrupt one
 * costs a network request, and throwing from it would make a stray byte in
 * `~/.skillgantry` the reason a launch fails.
 */
export async function loadUpgradeState(home: string): Promise<UpgradeState | null> {
  try {
    return JSON.parse(await readFile(stateFile(home), 'utf8')) as UpgradeState
  } catch {
    return null
  }
}

export async function saveUpgradeState(home: string, state: UpgradeState): Promise<void> {
  await mkdir(home, { recursive: true })
  await writeFile(stateFile(home), `${JSON.stringify(state, null, 2)}\n`)
}
```

- [ ] **Step 6: Re-export from `src/core/index.ts`, run the tests**

```bash
pnpm vitest run tests/core/upgrade/state.test.ts && pnpm lint
```
Expected: PASS, and lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/core tests/core/upgrade
git commit -m "feat(upgrade): export the semver comparator and hold the check's cache"
```

---

### Task 5: The changelog parser

**Files:**
- Create: `src/core/upgrade/changelog.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/upgrade/changelog.test.ts`

**Interfaces:**
- Consumes: `ChangelogEntry` from Task 4.
- Produces: `parseChangelog(text: string): ChangelogEntry[]` (document order, newest first as the file is written); `entriesAbove(entries, version): ChangelogEntry[]`.

- [ ] **Step 1: Write the failing tests**

`tests/core/upgrade/changelog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { entriesAbove, parseChangelog } from '../../../src/core/index.js'

const DOC = `# Changelog

## 0.6.0 — 2026-08-14
- feat(tui): two-level repo and skill navigation
- fix(core): reproduce the candidate manifest

## 0.5.1 — 2026-08-10
- fix(specs,tui): state the revision the body reached

## 0.5.0 — 2026-08-10
`

describe('parseChangelog', () => {
  it('splits on version headings and keeps each body', () => {
    const entries = parseChangelog(DOC)
    expect(entries.map((e) => e.version)).toEqual(['0.6.0', '0.5.1', '0.5.0'])
    expect(entries[0]?.lines).toEqual([
      'feat(tui): two-level repo and skill navigation',
      'fix(core): reproduce the candidate manifest',
    ])
  })

  // A version with nothing under it is a real state — 0.5.0 above — and must
  // parse to an empty body rather than swallowing the next section.
  it('yields an empty body for a section with no bullets', () => {
    expect(parseChangelog(DOC)[2]).toEqual({ version: '0.5.0', lines: [] })
  })

  it('ignores headings that are not versions', () => {
    expect(parseChangelog('# Changelog\n\n## Unreleased\n- x\n')).toEqual([])
  })
})

describe('entriesAbove', () => {
  it('keeps only versions strictly greater than the running one', () => {
    expect(entriesAbove(parseChangelog(DOC), '0.5.1').map((e) => e.version)).toEqual(['0.6.0'])
  })

  it('spans every intervening version', () => {
    expect(entriesAbove(parseChangelog(DOC), '0.4.9').map((e) => e.version)).toEqual([
      '0.6.0',
      '0.5.1',
      '0.5.0',
    ])
  })

  it('returns nothing when the running version is the newest', () => {
    expect(entriesAbove(parseChangelog(DOC), '0.6.0')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/core/upgrade/changelog.test.ts
```
Expected: FAIL — no export named `parseChangelog`.

- [ ] **Step 3: Implement**

```ts
import { compareSemver } from '../release/version.js'
import type { ChangelogEntry } from './types.js'

const HEADING = /^## (\d+\.\d+\.\d+)(?:\s|$)/

/**
 * Sections in document order. A heading that is not a version — `## Unreleased`
 * — opens nothing, so its bullets belong to no entry and are dropped rather
 * than attributed to the section above it.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let open: { version: string; lines: string[] } | null = null

  for (const raw of text.split('\n')) {
    const heading = HEADING.exec(raw)
    if (heading) {
      if (open) entries.push(open)
      open = { version: heading[1] as string, lines: [] }
      continue
    }
    if (raw.startsWith('## ')) {
      if (open) entries.push(open)
      open = null
      continue
    }
    if (open && raw.startsWith('- ')) open.lines.push(raw.slice(2).trim())
  }
  if (open) entries.push(open)
  return entries
}

/** Strictly greater, so re-running a check on the current version shows nothing. */
export function entriesAbove(
  entries: readonly ChangelogEntry[],
  version: string,
): ChangelogEntry[] {
  return entries.filter((entry) => compareSemver(entry.version, version) > 0)
}
```

- [ ] **Step 4: Run to verify it passes, re-export, commit**

```bash
pnpm vitest run tests/core/upgrade/changelog.test.ts
git add src/core tests/core/upgrade
git commit -m "feat(upgrade): parse CHANGELOG.md and slice the entries above a version"
```

---

### Task 6: Eligibility

**Files:**
- Create: `src/core/upgrade/eligible.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/upgrade/eligible.test.ts`

**Interfaces:**
- Consumes: `Eligibility` from Task 4.
- Produces: `resolveEligibility(entryPath: string, home: string): Promise<Eligibility>`.

- [ ] **Step 1: Write the failing tests**

`tests/core/upgrade/eligible.test.ts`:

```ts
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveEligibility } from '../../../src/core/index.js'

async function fixture(): Promise<{ home: string; bin: string }> {
  const root = await mkdtemp(join(tmpdir(), 'sg-elig-'))
  return { home: join(root, '.skillgantry'), bin: join(root, 'bin') }
}

describe('resolveEligibility', () => {
  it('accepts a link into the versioned prefix', async () => {
    const { home, bin } = await fixture()
    const target = join(home, 'versions', '0.5.1', 'node_modules', '.bin', 'skillgantry')
    await mkdir(join(home, 'versions', '0.5.1', 'node_modules', '.bin'), { recursive: true })
    await writeFile(target, '#!/usr/bin/env node\n')
    await mkdir(bin, { recursive: true })
    const link = join(bin, 'skillgantry')
    await symlink(target, link)

    const result = await resolveEligibility(link, home)
    expect(result.kind).toBe('owned')
    if (result.kind === 'owned') expect(result.link).toBe(link)
  })

  // The flat prefix predates the versioned layout and is still ours to replace.
  it('accepts a link into the legacy flat prefix', async () => {
    const { home, bin } = await fixture()
    const target = join(home, 'cli', 'node_modules', '.bin', 'skillgantry')
    await mkdir(join(home, 'cli', 'node_modules', '.bin'), { recursive: true })
    await writeFile(target, '#!/usr/bin/env node\n')
    await mkdir(bin, { recursive: true })
    const link = join(bin, 'skillgantry')
    await symlink(target, link)

    expect((await resolveEligibility(link, home)).kind).toBe('owned')
  })

  it('refuses a development working tree and names it', async () => {
    const { home } = await fixture()
    const tree = await mkdtemp(join(tmpdir(), 'sg-dev-'))
    const entry = join(tree, 'dist', 'cli', 'index.js')
    await mkdir(join(tree, 'dist', 'cli'), { recursive: true })
    await writeFile(entry, '')

    const result = await resolveEligibility(entry, home)
    expect(result.kind).toBe('foreign')
    if (result.kind === 'foreign') {
      expect(result.runningFrom).toContain(tree)
      expect(result.advice).toMatch(/install:cli/)
    }
  })

  // Under the prefix but invoked directly: owned bytes, but no link to swing,
  // so adopting a new version would leave this invocation on the old one.
  it('refuses an entry point that is not a symlink', async () => {
    const { home } = await fixture()
    const target = join(home, 'versions', '0.5.1', 'node_modules', '.bin', 'skillgantry')
    await mkdir(join(home, 'versions', '0.5.1', 'node_modules', '.bin'), { recursive: true })
    await writeFile(target, '')

    const result = await resolveEligibility(target, home)
    expect(result.kind).toBe('foreign')
    if (result.kind === 'foreign') expect(result.advice).toMatch(/not through the link/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/core/upgrade/eligible.test.ts
```
Expected: FAIL — no export named `resolveEligibility`.

- [ ] **Step 3: Implement**

```ts
import { lstat, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Eligibility } from './types.js'

const under = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)

/**
 * R13.10. `entryPath` is `process.argv[1]`, which is the path the shell
 * resolved — the *link*, not its target — so both halves are available without
 * scanning PATH: the link to rename over, and the target that says whose
 * install this is.
 *
 * An entry point that is not a symlink is refused even when its bytes are
 * ours. There is nothing to swing, so adopting a new version would leave this
 * invocation running the old one — which reads as an upgrade that silently did
 * nothing.
 */
export async function resolveEligibility(
  entryPath: string,
  home: string,
): Promise<Eligibility> {
  const versionsRoot = join(home, 'versions')
  const legacyRoot = join(home, 'cli')

  let target: string
  try {
    target = await realpath(entryPath)
  } catch {
    return {
      kind: 'foreign',
      runningFrom: entryPath,
      advice: 'the running entry point could not be resolved',
    }
  }

  if (!under(target, versionsRoot) && !under(target, legacyRoot)) {
    return {
      kind: 'foreign',
      runningFrom: target,
      advice: `this build does not run from ${home}. Update it where it came from — a working tree with \`pnpm install:cli\`, or \`npx skillgantry@latest\``,
    }
  }

  const link = await lstat(entryPath)
  if (!link.isSymbolicLink()) {
    return {
      kind: 'foreign',
      runningFrom: target,
      advice: 'this build was invoked directly and not through the link on PATH, so there is nothing to repoint',
    }
  }

  return { kind: 'owned', link: entryPath, target, versionsRoot }
}
```

- [ ] **Step 4: Run, re-export, commit**

```bash
pnpm vitest run tests/core/upgrade/eligible.test.ts
git add src/core tests/core/upgrade
git commit -m "feat(upgrade): refuse to upgrade an install SkillGantry did not make (R13.10)"
```

---

### Task 7: The check

**Files:**
- Create: `src/core/upgrade/check.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/upgrade/check.test.ts`

**Interfaces:**
- Consumes: `loadUpgradeState`/`saveUpgradeState` (Task 4), `parseChangelog`/`entriesAbove` (Task 5), `compareSemver` (Task 4).
- Produces: `checkForUpgrade(options: CheckOptions): Promise<UpgradeCheck>`, `THROTTLE_MS`, `DEFAULT_REPO`.

```ts
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
```

- [ ] **Step 1: Write the failing tests**

`tests/core/upgrade/check.test.ts` — build a `fetchImpl` returning a canned `releases/latest` payload plus a canned `CHANGELOG.md`, and assert:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkForUpgrade, loadUpgradeState, saveUpgradeState } from '../../../src/core/index.js'

const CHANGELOG = '# Changelog\n\n## 0.6.0 — 2026-08-14\n- feat: a thing\n\n## 0.5.1 — 2026-08-10\n- fix: another\n'

function fakeFetch(tag = 'v0.6.0'): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/releases/latest')) {
      return new Response(
        JSON.stringify({
          tag_name: tag,
          published_at: '2026-08-14T10:00:00Z',
          html_url: 'https://example.test/release',
          assets: [
            { name: `skillgantry-${tag.slice(1)}.tgz`, browser_download_url: 'https://example.test/t.tgz' },
            { name: 'SHA256SUMS', browser_download_url: 'https://example.test/SHA256SUMS' },
            { name: 'CHANGELOG.md', browser_download_url: 'https://example.test/CHANGELOG.md' },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response(CHANGELOG, { status: 200 })
  }) as unknown as typeof fetch
}

const home = async () => mkdtemp(join(tmpdir(), 'sg-check-'))
const T0 = Date.parse('2026-08-11T09:00:00.000Z')

describe('checkForUpgrade', () => {
  it('reports a newer release with the entries above the running version', async () => {
    const result = await checkForUpgrade({
      home: await home(), currentVersion: '0.5.1', now: T0, fetchImpl: fakeFetch(),
    })
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      expect(result.release.version).toBe('0.6.0')
      expect(result.release.entries.map((e) => e.version)).toEqual(['0.6.0'])
    }
  })

  it('reports current when the release is not newer', async () => {
    const result = await checkForUpgrade({
      home: await home(), currentVersion: '0.6.0', now: T0, fetchImpl: fakeFetch(),
    })
    expect(result.kind).toBe('current')
  })

  it('skips the network inside the throttle window', async () => {
    const dir = await home()
    const fetchImpl = fakeFetch()
    await checkForUpgrade({ home: dir, currentVersion: '0.5.1', now: T0, fetchImpl })
    const again = await checkForUpgrade({
      home: dir, currentVersion: '0.5.1', now: T0 + 60_000, fetchImpl,
    })
    expect(again.kind).toBe('available')          // still prompts, from cache
    expect(fetchImpl).toHaveBeenCalledTimes(2)    // one release + one changelog, from the first call only
  })

  it('checks again once the window has passed', async () => {
    const dir = await home()
    const fetchImpl = fakeFetch()
    await checkForUpgrade({ home: dir, currentVersion: '0.5.1', now: T0, fetchImpl })
    await checkForUpgrade({
      home: dir, currentVersion: '0.5.1', now: T0 + 25 * 3600_000, fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  // A failed request must not buy 24 hours of silence.
  it('reports unreachable and does not record the attempt', async () => {
    const dir = await home()
    const failing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const result = await checkForUpgrade({
      home: dir, currentVersion: '0.5.1', now: T0, fetchImpl: failing,
    })
    expect(result.kind).toBe('unreachable')
    expect(await loadUpgradeState(dir)).toBeNull()
  })

  it('reports unreachable on a non-ok response', async () => {
    const bad = (async () => new Response('rate limited', { status: 403 })) as unknown as typeof fetch
    const result = await checkForUpgrade({
      home: await home(), currentVersion: '0.5.1', now: T0, fetchImpl: bad,
    })
    expect(result.kind).toBe('unreachable')
  })

  it('honours a recorded decline', async () => {
    const dir = await home()
    await saveUpgradeState(dir, {
      lastCheckedAt: new Date(T0).toISOString(), declinedVersion: '0.6.0', latest: null,
    })
    const result = await checkForUpgrade({
      home: dir, currentVersion: '0.5.1', now: T0 + 25 * 3600_000, fetchImpl: fakeFetch(),
    })
    expect(result.kind).toBe('declined')
  })

  it('prompts again for a version above the declined one', async () => {
    const dir = await home()
    await saveUpgradeState(dir, {
      lastCheckedAt: new Date(T0).toISOString(), declinedVersion: '0.6.0', latest: null,
    })
    const result = await checkForUpgrade({
      home: dir, currentVersion: '0.5.1', now: T0 + 25 * 3600_000, fetchImpl: fakeFetch('v0.7.0'),
    })
    expect(result.kind).toBe('available')
  })

  it('force ignores both the throttle and the decline', async () => {
    const dir = await home()
    await saveUpgradeState(dir, {
      lastCheckedAt: new Date(T0).toISOString(), declinedVersion: '0.6.0', latest: null,
    })
    const fetchImpl = fakeFetch()
    const result = await checkForUpgrade({
      home: dir, currentVersion: '0.5.1', now: T0, force: true, fetchImpl,
    })
    expect(result.kind).toBe('available')
    expect(fetchImpl).toHaveBeenCalled()
  })

  // A check that found nothing must not leave the throttled path reporting a
  // version it never saw.
  it('caches latest: null when nothing is newer', async () => {
    const dir = await home()
    await checkForUpgrade({ home: dir, currentVersion: '0.6.0', now: T0, fetchImpl: fakeFetch() })
    expect((await loadUpgradeState(dir))?.latest).toBeNull()
    const again = await checkForUpgrade({
      home: dir, currentVersion: '0.6.0', now: T0 + 60_000, fetchImpl: fakeFetch(),
    })
    expect(again.kind).toBe('current')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/core/upgrade/check.test.ts
```
Expected: FAIL — no export named `checkForUpgrade`.

- [ ] **Step 3: Implement**

Resolve `<apiBase>/repos/<repo>/releases/latest` with `signal: AbortSignal.timeout(timeoutMs ?? 2000)`. `releases/latest` excludes drafts and prereleases by construction, so there is no client-side filter. Strip a leading `v` from `tag_name`. Find the three assets by exact name (`skillgantry-<version>.tgz`, `SHA256SUMS`, `CHANGELOG.md`); a missing one is `unreachable`, not a crash. Fetch the changelog asset, `parseChangelog`, `entriesAbove(currentVersion)`. Write state **only on a successful request**, then decide `available` / `declined` / `current`. Wrap the whole request in one `try` returning `{ kind: 'unreachable', reason }`.

```ts
export const THROTTLE_MS = 24 * 60 * 60 * 1000
export const DEFAULT_REPO = 'kevinlin/skill-gantry'
```

- [ ] **Step 4: Run, re-export, commit**

```bash
pnpm vitest run tests/core/upgrade/check.test.ts && pnpm lint
git add src/core tests/core/upgrade
git commit -m "feat(upgrade): resolve the latest release under a 24h throttle (R13.11)"
```

---

### Task 8: The apply

**Files:**
- Create: `src/core/upgrade/apply.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/upgrade/apply.test.ts`

**Interfaces:**
- Consumes: `ReleaseInfo` (Task 4), `Exec` from `src/core/tools/exec.js`.
- Produces:

```ts
export type ApplyStep =
  | 'download' | 'verify-download' | 'install' | 'verify-install'
  | 'snapshot' | 'relink' | 'prune'

export interface ApplyOptions {
  release: ReleaseInfo
  home: string
  /** The symlink to rename over, from `Eligibility`. */
  link: string
  fromVersion: string
  fetchImpl?: typeof fetch
  exec?: Exec
  onProgress?: (step: ApplyStep, detail: string) => void
}

export interface ApplyResult {
  version: string
  prefix: string
  /** `<prefix>/node_modules/skillgantry/dist/cli/index.js` — what Task 12 spawns. */
  entry: string
}

export async function applyUpgrade(options: ApplyOptions): Promise<ApplyResult>
```

- [ ] **Step 1: Write the failing tests**

`tests/core/upgrade/apply.test.ts`. Serve a small real tarball through `fetchImpl`, and fake `Exec` so `npm install` just materialises the expected tree:

```ts
// The fake Exec stands in for npm: it creates the tree npm would create, so
// every assertion below is about apply's ordering rather than about npm.
function fakeNpm(version: string, reported = version): Exec {
  return async (_bin, argv) => {
    const prefix = argv[argv.indexOf('--prefix') + 1] as string
    const bin = join(prefix, 'node_modules', '.bin')
    await mkdir(join(prefix, 'node_modules', 'skillgantry', 'dist', 'cli'), { recursive: true })
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'skillgantry'), `#!/bin/sh\necho ${reported}\n`, { mode: 0o755 })
    return { stdout: '', stderr: '' }
  }
}
```

Cases, each asserting on the filesystem afterwards:

- success: `versions/0.6.0` exists, `realpath(link)` is inside it, `backup/0.5.1/config.json` exists, `ApplyResult.entry` ends `dist/cli/index.js`, `onProgress` saw all seven steps in order.
- **checksum mismatch** (serve `SHA256SUMS` with a wrong digest): rejects, `versions/0.6.0` does not exist, `realpath(link)` still resolves to the old prefix, nothing under `versions/` starts with `.tmp-`.
- **post-install version mismatch** (`fakeNpm('0.6.0', '0.5.1')`): rejects naming both versions, `realpath(link)` unchanged.
- **snapshot precedes relink**: record the order of `onProgress` steps and assert `snapshot` comes before `relink`.
- **prune retains exactly two**: seed `versions/0.3.0`, `0.4.0`, `0.5.1`; after upgrading to `0.6.0` only `0.5.1` and `0.6.0` remain.
- **legacy flat prefix removed only after a successful relink**: seed `<home>/cli/node_modules`, upgrade, assert it is gone; then repeat with a failing checksum and assert it survives.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/core/upgrade/apply.test.ts
```
Expected: FAIL — no export named `applyUpgrade`.

- [ ] **Step 3: Implement the seven steps**

Stage in `<home>/versions/.tmp-<version>/` — same filesystem as the destination, so no step crosses a device boundary. Reuse the `SHA256SUMS` line-matching shape from [gh-release.ts](src/core/tools/gh-release.ts) (`parts[1] === name || parts[1] === '*' + name`). Verify the installed binary with `exec(binPath, ['--version'])` and require `stdout.trim() === release.version`. Relink:

```ts
// R13.10. `rename` over an existing symlink is atomic; `ln -sfn` unlinks then
// symlinks and leaves a window in which no command is on PATH. §12.5's one
// atomic rename, applied to the binary instead of a baseline file.
const staged = `${link}.${process.pid}.tmp`
await symlink(join(prefix, 'node_modules', '.bin', 'skillgantry'), staged)
await rename(staged, link)
```

Wrap steps 1–5 in a `try` whose `catch` removes the temp directory and the half-built prefix before rethrowing, so a failure before the rename leaves the installation byte-identical (R13.12). Steps 6 and 7 sit outside it; a `prune` failure is caught, reported through `onProgress` and swallowed.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm vitest run tests/core/upgrade/apply.test.ts && pnpm lint
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core tests/core/upgrade
git commit -m "feat(upgrade): verify before adopting, and adopt with one atomic rename (R13.12)"
```

---

### Task 9: `install-cli.sh` moves to the versioned layout

**Files:**
- Modify: `scripts/install-cli.sh`

- [ ] **Step 1: Change the prefix and the link**

Replace `CLI_PREFIX="$SG_HOME/cli"` with `CLI_PREFIX="$SG_HOME/versions/$version"`, reading `version` from the manifest **before** the pack step:

```bash
version="$(node -p 'require("'"$ROOT"'/package.json").version')"
CLI_PREFIX="$SG_HOME/versions/$version"
```

Replace the `rm -rf "$CLI_PREFIX"` with a removal of that one version's prefix only — re-running the installer for the same version must still be idempotent, but it must not delete a sibling version the upgrade path is retaining.

- [ ] **Step 2: Replace `ln -sfn` with the atomic rename**

```bash
# One atomic rename, matching the upgrade path (design §20): `ln -sfn` unlinks
# before it symlinks, leaving a window with no command on PATH.
mkdir -p "$SG_BIN_DIR"
ln -s "$CLI_PREFIX/node_modules/.bin/skillgantry" "$LINK.$$.tmp"
mv -f "$LINK.$$.tmp" "$LINK"
```

- [ ] **Step 3: Prune to two versions and remove a legacy flat prefix**

After the verify step, keep the two newest directories under `$SG_HOME/versions` by `sort -V` and remove the rest, then `rm -rf "$SG_HOME/cli"` if it exists.

- [ ] **Step 4: Verify on a temp home**

```bash
SG_HOME=$(mktemp -d)/sg SG_BIN_DIR=$(mktemp -d) pnpm install:cli
```
Expected: the summary reports the current version, and the link resolves into `versions/<version>/node_modules/.bin/skillgantry`.

- [ ] **Step 5: Run the acceptance suite, then commit**

```bash
pnpm acceptance
git add scripts/install-cli.sh
git commit -m "build: install each version into its own prefix (R13.10)"
```

---

### Task 10: Version-aware config and lock load errors

**Files:**
- Modify: `src/core/config/config.ts:48-56`
- Test: `tests/core/config.test.ts` (add cases to the existing file)

**Interfaces:**
- Produces: no new export. `loadConfig` and `loadToolLock` throw a named error instead of a raw zod one when the document's `version` is not the one this build reads.

- [ ] **Step 1: Write the failing tests**

Write a `config.json` with `version: 2` into a temp home and assert `loadConfig` rejects with a message naming `2`, `1`, `skillgantry upgrade` and the backup path. Assert a document that is malformed for any *other* reason still rejects with the zod error, unchanged.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/core/config.test.ts -t 'version'
```
Expected: FAIL — the message is the raw zod error.

- [ ] **Step 3: Implement**

```ts
/**
 * R13.12. A version literal that has moved is the one parse failure a user can
 * act on, and the raw zod error for it names neither number. Every other
 * failure keeps the zod error, which already points at the offending key.
 */
function versionMismatch(file: string, raw: unknown, expected: number): string | null {
  const found = (raw as { version?: unknown } | null)?.version
  if (typeof found !== 'number' || found === expected) return null
  return (
    `${file} was written by a different skillgantry (document version ${found}; ` +
    `this build reads ${expected}). Upgrade with \`skillgantry upgrade\`, or restore ` +
    `the copy under ~/.skillgantry/backup/.`
  )
}
```

Parse the JSON once, run `versionMismatch` before `configSchema.parse`, throw the named error when it returns a string. Same shape in `loadToolLock`.

- [ ] **Step 4: Run to verify it passes, commit**

```bash
pnpm vitest run tests/core/config.test.ts
git add src/core/config tests/core
git commit -m "fix(config): name the version that wrote a document this build cannot read"
```

---

### Task 11: The prompt

**Files:**
- Create: `src/tui/upgrade-app.tsx`
- Modify: `src/tui/index.tsx`
- Test: `tests/tui/upgrade-prompt.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface UpgradeAppProps {
  fromVersion: string
  toVersion: string
  publishedAt: string
  entries: readonly { version: string; lines: readonly string[] }[]
  installPath: string
  onAnswer: (answer: 'upgrade' | 'skip') => void
}
export function renderUpgrade(props: Omit<UpgradeAppProps, 'onAnswer'>): Promise<'upgrade' | 'skip'>
```

- [ ] **Step 1: Write the failing tests**

Using `tests/helpers/render-ink.tsx`, assert: the frame names both versions and the install path; `y` resolves `'upgrade'` and `n` resolves `'skip'`; every other key is inert; the entries render newest first with their version headings; at 50×14 the notes are truncated with a count of what was dropped and the frame still fits; two entries both render when the user is two versions behind.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/tui/upgrade-prompt.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

A `Panel`-bordered box titled `upgrade available`, using the D23 palette tokens from `src/tui/tokens.ts`. Two keys only, through `useInput`. No `alternateScreen` in `renderUpgrade`, matching `renderSetup` — the decision stays in the user's scrollback. Reserve rows for the frame and the footer, then give the remainder to the entries and report the count dropped, the same shape the Findings pane already uses.

- [ ] **Step 4: Run to verify it passes, commit**

```bash
pnpm vitest run tests/tui/upgrade-prompt.test.tsx && pnpm lint
git add src/tui tests/tui
git commit -m "feat(tui): offer an available upgrade before the main screen mounts (R11.24)"
```

---

### Task 12: `skillgantry upgrade`

**Files:**
- Create: `src/cli/upgrade-command.ts`
- Modify: `src/cli/run-command.ts`
- Test: `tests/cli/upgrade-command.test.ts`

**Interfaces:**
- Consumes: `checkForUpgrade`, `applyUpgrade`, `resolveEligibility`, `saveUpgradeState`, `renderUpgrade`, `VERSION`.
- Produces:

```ts
export const UPGRADE_EXIT = {
  ok: 0, available: 1, foreign: 2, unreachable: 3,
  integrity: 4, versionMismatch: 5, unauthorised: 6,
} as const

export interface UpgradeOptions { yes?: boolean; json?: boolean; check?: boolean }
export async function runUpgrade(deps: CliDeps, options: UpgradeOptions): Promise<number>
```

- [ ] **Step 1: Write the failing tests**

Drive `buildProgram(deps)` with a fake `write` and a temp home. Assert: `--check` on a current build exits `0`; `--check` with a newer release exits `1` and writes nothing under `versions/`; a foreign install exits `2` and prints the advice; an unreachable check exits `3`; no `--yes` off a TTY prints the available version, installs nothing and exits `6`; `--json` prints one parseable document carrying `current`, `latest` and `entries`; a recorded decline is ignored.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/cli/upgrade-command.test.ts
```
Expected: FAIL — unknown command `upgrade`.

- [ ] **Step 3: Implement**

`runUpgrade` calls `checkForUpgrade({ force: true })`, then `resolveEligibility(process.argv[1], deps.home)`. Prompt only when `process.stdout.isTTY` and `--yes` is absent. Progress lines go through `deps.write` in `install-cli.sh`'s register (`download`, `verify`, `install`, …). **It never relaunches** — R12.10. Register the subcommand in `run-command.ts` beside `evals`, and assign `program.exitCode` the way every other command does.

- [ ] **Step 4: Run to verify it passes, commit**

```bash
pnpm vitest run tests/cli/upgrade-command.test.ts && pnpm lint
git add src/cli tests/cli
git commit -m "feat(cli): add skillgantry upgrade (R12.10)"
```

---

### Task 13: The root action and the relaunch

**Files:**
- Modify: `src/cli/upgrade-command.ts` (add `maybeUpgrade`)
- Modify: `src/cli/run-command.ts` (root action)
- Test: `tests/cli/upgrade-launch.test.ts`

**Interfaces:**
- Produces: `maybeUpgrade(deps: CliDeps): Promise<'continue' | 'relaunched'>`.

- [ ] **Step 1: Write the failing tests**

Assert: with `SG_UPGRADED_FROM` set, `maybeUpgrade` returns `'continue'` and makes **no** network call — the loop guard; an unreachable check returns `'continue'` and prints nothing; a foreign install with a newer release prints one line and returns `'continue'`; `skip` records `declinedVersion` and returns `'continue'`; and a second launch after a decline never reaches the prompt. Assert the root action still starts the TUI in each `'continue'` case through the existing `deps.startTui` seam.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/cli/upgrade-launch.test.ts
```
Expected: FAIL — no export named `maybeUpgrade`.

- [ ] **Step 3: Implement**

```ts
// R13.12. Two independent guards stop a respawn loop: apply's post-install
// version equality, and this. A loop in a TTY is not something a user can
// easily escape, so neither guard is the only one.
if (process.env['SG_UPGRADED_FROM']) return 'continue'
```

On `'upgrade'`, apply, then:

```ts
const result = spawnSync(
  process.execPath,
  [applied.entry, ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, SG_UPGRADED_FROM: VERSION } },
)
process.exitCode = result.status ?? 0
return 'relaunched'
```

`process.execPath` plus the new entry file, not the PATH link: the relaunch then depends on neither the rename having been observed nor the shell's command hash. Call `maybeUpgrade` in the root action after the existing mutation-record scan, and return without starting the TUI when it answers `'relaunched'`.

- [ ] **Step 4: Run to verify it passes, commit**

```bash
pnpm vitest run tests/cli/upgrade-launch.test.ts && pnpm test
git add src/cli tests/cli
git commit -m "feat(cli): offer an upgrade at launch and relaunch into it (R11.24, R13.12)"
```

---

### Task 14: The doctor condition

**Files:**
- Modify: `src/core/tools/doctor.ts:71-96`
- Modify: `src/cli/doctor-command.ts`
- Test: `tests/core/doctor.test.ts`, `tests/cli/doctor-command.test.ts`

**Interfaces:**
- Produces:

```ts
/** Not a `ToolDriftKind`: SkillGantry is not one of the tools in the lock, and
    widening that union would put it into every per-tool loop over the kinds. */
export interface UpgradeFinding {
  current: string
  latest: string
}

// on DoctorInput
upgradeAvailable?: { current: string; latest: string } | null
// on DoctorReport
upgrade: UpgradeFinding | null
```

- [ ] **Step 1: Write the failing tests**

Assert: `doctor()` given `upgradeAvailable` puts it on `report.upgrade` and leaves `report.failed` untouched; given `null` or nothing, `report.upgrade` is `null`; `formatDoctor` renders `skillgantry-outdated  0.5.1 installed, 0.6.0 available — run \`skillgantry upgrade\`` and omits the line entirely when there is nothing to report; an unreachable check does not fail the report.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run tests/core/doctor.test.ts -t 'upgrade'
```
Expected: FAIL — `upgrade` is not a property of `DoctorReport`.

- [ ] **Step 3: Implement**

A separate `DoctorReport.upgrade` field rather than a new member of `ToolDriftKind`: SkillGantry is not one of the tools in the lock, and widening that union would put it into every per-tool loop that iterates the kinds. `doctor-command.ts` performs the check with `force: true` and passes the result in as data, exactly as it already does for the lifecycle cache — `src/core/tools/` gains no network dependency.

- [ ] **Step 4: Run to verify it passes, commit**

```bash
pnpm vitest run tests/core/doctor.test.ts tests/cli/doctor-command.test.ts
git add src/core/tools src/cli tests
git commit -m "feat(doctor): report an available release without installing it (R13.11)"
```

---

### Task 15: Acceptance

**Files:**
- Create: `tests/acceptance/m12.test.ts`

- [ ] **Step 1: Write the test**

Two cases, both driving the real CLI through `tests/helpers/child.ts`, on `tests/acceptance/m5.test.ts`'s precedent that crash safety cannot be proved by a unit test:

1. **A real install upgraded end to end.** Run `install-cli.sh` into a temporary `SG_HOME`/`SG_BIN_DIR`. Serve a release from a local `http` server whose tarball is a second `pnpm pack` with a bumped version. Run `skillgantry upgrade --yes` through the link. Assert the link now resolves into `versions/<new>`, `skillgantry --version` reports the new version, `versions/<old>` still exists, and `backup/<old>/config.json` was written.
2. **Killed between verify and relink.** Start the same upgrade with `SG_UPGRADE_PAUSE_BEFORE_RELINK=1` (an env-gated `await` inside `applyUpgrade`, guarded so it costs nothing when unset), kill the child with `SIGKILL` once the `verify-install` progress line is seen, then assert `skillgantry --version` still reports the **old** version and the link is intact.

- [ ] **Step 2: Run under the acceptance flag**

```bash
SG_ACCEPTANCE=1 pnpm vitest run tests/acceptance/m12.test.ts
```
Expected: PASS.

- [ ] **Step 3: Full check, then commit**

```bash
pnpm check
git add tests/acceptance src/core/upgrade
git commit -m "test(m12): prove an upgrade adopts atomically and survives a kill"
```

---

## Requirement coverage

| Requirement | Task |
|---|---|
| R13.8 tag/manifest and changelog assertions, three assets, body from the changelog | 3 |
| R13.9 CHANGELOG.md maintained, backfilled, read from the release asset | 2, 5, 7 |
| R13.10 versioned prefix, atomic relink, retention, foreign refusal | 6, 8, 9 |
| R13.11 throttle, no blocking, failure not recorded, decline sticks | 7, 14 |
| R13.12 verify before adopt, snapshot, no-op on failure, relaunch guard | 8, 10, 13, 15 |
| R11.24 the prompt, two answers, decline recorded, interrupt is not an answer | 11, 13 |
| R12.10 `skillgantry upgrade`, `--check` exit direction, no relaunch, coded failures | 12 |
| M9 spec amendments, D30–D31 | 1 |

## Deviations found while implementing

**Task 1 — the milestone is M9, not M12.** The plan was written against a milestone numbering the tree renumbered before implementation started: `index.md` and this file's own name say M9. The plan body and [design_version-check-and-upgrade.md](design_version-check-and-upgrade.md) said M12 throughout and were rewritten to M9. The pre-existing `| M9 | R11.23 |` row — [plan_m7.2-repo-skill-navigation.md](plan_m7.2-repo-skill-navigation.md)'s work, which `index.md` now calls M7.2 — was left as it stands by decision, so § Milestone ownership carries two rows labelled M9. The traceability test keys on the requirement id rather than on the label, so this passes; the table is the thing that reads wrong, and correcting it is a separate pass over the shipped rows.

**Task 1 — `tests/specs/traceability.test.ts` has a third case the plan did not mention.** `states the revision the body has actually reached` compares requirements.md's `**Status:** revision N` header against the highest `(rev N)` marker in the body, so the seven new requirements marked *(rev 25)* failed the build until the header was bumped to 25 and the running paragraph gained its rev 25 sentence. Step 4's expected failure was therefore two failures, not one.

**Task 1 — §17's table is not what the coverage test parses.** The test unions every `*Satisfies …*` label in design.md and design_tui.md; §17's requirement-group table is prose. Adding the three rows Step 5 asks for therefore left the test red, and the labels are what closed it: `*Satisfies R13.8–R13.12.*` opening §20, `R12.10` appended to §15's label, and `*Satisfies R11.24.*` opening §14.14.

**Task 6 — the roots are `realpath`'d too, or every install reads as foreign.** `resolveEligibility` resolves the entry point and compares it against `<home>/versions`, and the plan compared a resolved path against an unresolved root. On macOS `os.tmpdir()` alone is `/var/folders/…` while the resolved entry point is `/private/var/folders/…`, so the owned case never matched. `resolveRoot` resolves each root and falls back to its literal spelling when it does not exist — a root that is not there cannot contain the entry point either.

**Task 7 — `latest` caches `null` for "checked, nothing newer".** The plan's own test requires it and the implementation has to slice for it: the resolved release is compared against the running version *before* the state is written, so the throttled path never reports a version it would have to re-compare.

**Task 9 — the layout is named in four more places than the plan lists.** `tests/acceptance/install-cli.test.ts` asserted `cli/node_modules/.bin` directly and failed the moment the prefix moved; it now asserts the versioned prefix and that the link resolves into the one named after the version the binary reports. `README.md`, `CLAUDE.md` and design.md §2 each documented `~/.skillgantry/cli`, including a `rm -rf` a user would copy, and were corrected with it.

**Task 12 — `runUpgrade` takes a trailing injection parameter.** The plan's test list needs `fetchImpl`, `Exec`, the entry path and the TTY answer all replaced, and none of them belongs on `UpgradeOptions`, which is commander's flags. `runUpgrade(deps, options, inject = {})` is `runEvals(…, userHome)`'s established shape: every field defaults to the real thing, and the subcommand's own call site passes none of them.

**Tasks 13 and 14 — two new `CliDeps` seams, and they are what keeps `pnpm test` offline.** The root action and `doctor` both now reach the release index, so *every* existing test driving either would have made a real request — `tests/cli/tui-command.test.ts`, `tests/cli/setup-command.test.ts` and `tests/cli/doctor-command.test.ts` among them. `deps.maybeUpgrade` and `deps.upgradeCheck` default to the real implementations and are stubbed in those suites, exactly as `deps.startTui` and `deps.startSetup` already are.

**Merge — the prompt is §14.14, not §14.13.** The plan told Task 1 to leave the duplicate `### 14.12` pair alone because that defect belonged to nobody. A spec lint landed on `main` while this branch was in flight (commit `c973ea4`) and fixed it, renumbering the setup repo step to §14.13 — which the branch's own new §14.13 then collided with, invisibly, because the collision only exists in the merged tree. The prompt is §14.14 and every reference in design.md §17, §18 and §20, in design_version-check-and-upgrade.md §8, and in this plan follows it. A merge that compiles and passes is not a merge that is consistent: nothing mechanical checks that two section numbers in one file differ.

**Task 15 — the binary had to learn `SG_HOME`, and the release source is two files.** `install-cli.sh` has honoured `SG_HOME` since M1 "so the acceptance test can install without touching a real home"; the binary did not, so `skillgantry upgrade --yes` under test would have installed into the developer's own `~/.skillgantry` and renamed their own `~/.local/bin/skillgantry`. `defaultDeps()` now reads it. `SG_UPGRADE_API_BASE` and `SG_UPGRADE_REPO` were added alongside, read in `src/cli/` and passed down as options, the way `GhReleaseOptions.apiBase` already works. The served release is built from `package.json` plus `dist/` alone — `files: ["dist"]` is the whole package, and `VERSION` reads the manifest, so bumping it is what makes the packed build answer `--version` with the new number.

## Changelog

- 2026-08-11 — Written.
- 2026-08-11 — Shipped. Renumbered M12 → M9 to match the tree's plan naming.
