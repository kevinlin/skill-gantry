# Version check and self-upgrade

**Date:** 2026-08-11
**Status:** design, approved. Implementation plan not yet written.
**Owns:** a new milestone M12.

SkillGantry ships from GitHub Releases. On launch the terminal interface asks whether a newer
release exists, shows what changed, and — only on confirmation — installs it, migrates what needs
migrating, and relaunches into it.

This document is the validated design. It is not a contract: `docs/specs/requirements.md` and
`docs/specs/design.md` become the contract once amended, per the precedence rule in `CLAUDE.md`.
§8 lists exactly which amendments those are.

---

## 1. What exists today, and what it forces

Facts established while designing, each of which constrains something below.

- The package is `skillgantry` 0.5.1. The repo `kevinlin/skill-gantry` is public and has **no tags,
  no releases**. The name is **not claimed on npm**.
- Installation is `scripts/install-cli.sh` from a working tree: build, `pnpm pack`,
  `npm install --prefix ~/.skillgantry/cli`, symlink `~/.local/bin/skillgantry`, then verify by
  invoking `--version`. The script `rm -rf`s the prefix on every run.
- `src/core/tools/gh-release.ts` already downloads GitHub release assets and verifies declared
  integrity. Its `Integrity` union — `sha256-asset`, `sha256-digest`, `none` with a written reason —
  is the vocabulary this design reuses.
- The ledger self-migrates: `MIGRATIONS[]` runs at every `openLedger` (`src/core/ledger/db.ts`).
- The rule-class map migration is deliberately **not** automatic (R8.14); its only trigger is
  `skillgantry doctor --migrate-rule-map`.
- `config.json` and `tools/lock.json` carry `version: z.literal(1)` and have **no migration path**.
  `loadConfig` rethrows the raw zod error on a mismatch, so the first release that bumps that
  literal breaks launch with an unreadable message.
- Import direction is `cli → tui → core`, lint-enforced. `src/tui/**` may touch the filesystem but
  **may not spawn**. So the check and the apply live in `src/core/`, wired by `src/cli/`, and the
  terminal component is presentation only.
- `src/core/release/version.ts` already holds a correct semver comparator, including the
  prerelease rule. It is module-private.

### 1.1 History is not monotonic

The changelog backfill (§5) depends on this. Walking `git log -- package.json` returns commit
`90b2143` carrying 0.5.0 *older* than `bac135b` carrying 0.4.4, because 0.5.0 landed on a branch
merged later. Version order is only monotonic along `--first-parent main`:

```
0.1.0  7ca847a  Merge branch 'worktree-m1-engine'
0.2.0  db2f6f3  ui (0.2.0): Impeccable polish
...
0.4.3  0774126  Version: 0.4.3
0.5.0  776952e  merge: two-level repo and skill navigation in the list column (R11.23)
0.5.1  a9005e0  merge: label each setup tool with the stage it serves
```

0.4.4 does not appear. It existed only on the branch merged as 0.5.0, so it was never a version of
main's tip and was never released. Dropping it is correct, and it is the first-parent walk that
drops it.

---

## 2. Release contract

`.github/workflows/release.yml`, triggered by `push: tags: ['v*']`, `permissions: contents: write`.
Setup steps identical to `check.yml`, then:

1. **Assert the tag matches the manifest.** `v$(node -p 'require("./package.json").version')` equals
   `$GITHUB_REF_NAME`, or fail. Without it a mistyped tag publishes an asset whose inner version
   disagrees with the release the client compared against, and the client loops: install 0.6.0,
   receive 0.5.1, still see 0.6.0 available.
2. **Assert `CHANGELOG.md` carries a `## <version>` section**, or fail. A release whose notes are
   missing is one the prompt displays blank.
3. `pnpm check`.
4. `pnpm pack --pack-destination release/` → `skillgantry-<version>.tgz`.
5. `sha256sum` that file into `release/SHA256SUMS`.
6. `gh release create "$GITHUB_REF_NAME" --notes-file <extracted section> release/*` plus
   `CHANGELOG.md`.

Both assertions exist for one reason: a release that is silently wrong is worse than one that fails
to publish.

**Three assets, fixed names:** `skillgantry-<version>.tgz`, `SHA256SUMS`, `CHANGELOG.md`. No
`{os}`/`{arch}` substitution — the tarball is platform-independent, unlike the binaries the
`gh-release` tool driver resolves.

The client reads `GET /repos/kevinlin/skill-gantry/releases/latest`, which **excludes drafts and
prereleases by construction**. Cutting a prerelease tag therefore prompts nobody, with no
client-side filter that could be got wrong. Fields consumed: `tag_name`, `published_at`, `html_url`,
`assets[]`.

Integrity is `sha256-asset` in the existing vocabulary: the checksum file is published beside the
tarball and a mismatch fails the install. Never `none`.

---

## 3. Home layout

A self-upgrade cannot `rm -rf` the tree its own process was loaded from. Versioned prefixes:

```
~/.skillgantry/
  versions/
    0.5.1/node_modules/.bin/skillgantry     one npm prefix per version
    0.6.0/node_modules/.bin/skillgantry
  upgrade.json                              throttle, cached release, declined version
  backup/0.5.1/{config.json,tools/lock.json}
~/.local/bin/skillgantry -> ~/.skillgantry/versions/0.6.0/node_modules/.bin/skillgantry
```

The new version is installed **and verified by invocation** before anything user-visible moves. The
switch is then `symlink(target, tmp)` followed by `rename(tmp, link)`. `rename` over an existing
symlink is atomic on POSIX; `ln -sfn` is unlink-then-symlink and leaves a window in which no command
is on `PATH`. This is design.md §12.5's "one atomic rename" applied to the binary rather than to a
baseline file.

`install-cli.sh` moves to the same layout, so the shape has one author rather than two that drift.

**Retention is exactly two** — current and previous. Older prefixes are pruned after a successful
relink. The previous prefix is what makes rollback a rename rather than a reinstall.

### 3.1 The legacy flat install

An existing `~/.skillgantry/cli/node_modules` is a real directory; the new layout has no `cli` path
at all, so one `stat` distinguishes them. The first upgrade from a flat install writes
`versions/<new>`, relinks, then removes `~/.skillgantry/cli`. That removal is the only delete in the
design, and it is safe because the link no longer resolves through it.

### 3.2 Ownership

`realpath(process.argv[1])` is accepted as ours when it sits under `<home>/versions/` **or** under
the legacy `<home>/cli/`. Anything else — a development working tree, `npx`, a foreign prefix — is
`foreign`: the check still reports a newer version, the upgrade refuses and names what it found and
what to run instead.

This is the git-skill driver's refuse-rather-than-clobber rule (design.md §5.2) applied to our own
binary, and it is what guarantees a development working tree can never be overwritten by the TUI it
is running.

---

## 4. Engine

Four modules under `src/core/upgrade/`, re-exported through `src/core/index.ts`. No `console`, no
`process.exit`. `fetchImpl` and `Exec` are injected, so the default test run stays offline — the
rule every install driver already follows.

| File | Job |
|---|---|
| `state.ts` | read/write `~/.skillgantry/upgrade.json`; the only filesystem it touches |
| `eligible.ts` | resolve the running entry point against `<home>` → owned / foreign |
| `check.ts` | resolve the latest release, apply the throttle, decide |
| `apply.ts` | the seven steps in §4.3 |

`compare` in `src/core/release/version.ts` is exported as `compareSemver` and reused. A second
comparator is how the release path and the upgrade path come to disagree about what "newer" means.

### 4.1 The throttle governs the request, not the prompt

```
loadState()
  cached age < 24h  ->  use the cached release, no network
                        (no cached release -> current, silent)
  else              ->  GET releases/latest; on success write state
compareSemver(latest, VERSION)
  <= 0                  -> current, silent
  > 0 but declined      -> silent
  > 0                   -> available
```

A check that found nothing newer caches `latest: null`, so the throttled path that follows it is
silent rather than reporting a version it never saw.

A user who quits without answering is prompted again next launch, at no API cost. Throttling the
prompt as well would leave a launch silent for a day about a version already sitting in the cache.

Every failure of the request — offline, 5xx, rate-limited, malformed JSON, 2s timeout — is
`unreachable`: swallowed, the launch proceeds, and `lastCheckedAt` is **not** written. A failed
check must not buy 24 hours of silence.

### 4.2 Two keys

`y` upgrades. `n` skips and records `declinedVersion`, so that version never prompts again.

There is no quit key: quitting the app at a prompt the user did not ask for is a key that exists
only to be hit by mistake, and `n` already reaches the terminal interface. A decline that sticks is
what keeps the feature from becoming a nag, and it is not a black hole — `doctor` still reports the
version, and `skillgantry upgrade` ignores the decline entirely.

### 4.3 Apply

Staged in `<home>/versions/.tmp-<version>/`, on the same filesystem as the destination so no step
crosses a device boundary. Each step emits an `onProgress` event; the caller owns rendering.

1. **download** — tarball and `SHA256SUMS`
2. **verify** — parse the tarball's line out of `SHA256SUMS`, compare against the computed digest;
   mismatch throws
3. **install** — `npm install --prefix <home>/versions/<version> <tarball>` through the injected
   `Exec`
4. **verify** — spawn the installed binary's `--version` and require it to **equal** `<version>`.
   `install-cli.sh` asserts only a semver shape; here the expected number is known, so the looser
   check would accept a tarball that installed the wrong release
5. **snapshot** — copy `config.json` and `tools/lock.json` to `<home>/backup/<fromVersion>/`,
   *before* the relink, so a rollback has the documents the old version wrote. An existing snapshot
   for that version is overwritten: it describes the same version's documents, and the later copy is
   the one a rollback from here would need
6. **relink** — `symlink` then atomic `rename`
7. **prune** — drop prefixes beyond current and previous; remove a legacy `<home>/cli`

**Any failure before step 6 is a no-op.** The temp directory and the half-built prefix are removed,
the failure is reported, and the launch continues on the current version, because nothing the
running installation resolves through was touched. A step 7 failure is cosmetic: reported, never
fatal.

### 4.4 Why no marker, no journal, no sandbox

`CLAUDE.md` records that `release`, `retire` and `suppress` each make a different safety trade and
that the reason must be stated rather than inferred. This path makes a fourth.

design.md §12's marker exists because a mutating *tool* writes into a live tree that cannot be
reconstructed. Here the new bytes are built where nothing resolves through them, verified by
invocation, and adopted by a single atomic rename whose predecessor is still on disk. There is no
window in which a crash leaves a partially-updated installation, so there is no state a marker could
describe. **Retaining the previous prefix is the rollback.**

### 4.5 Relaunch and the loop guard

```
spawnSync(process.execPath,
          ['<newPrefix>/node_modules/skillgantry/dist/cli/index.js', ...process.argv.slice(2)],
          { stdio: 'inherit', env: { ...process.env, SG_UPGRADED_FROM: '<oldVersion>' } })
process.exitCode = status
```

`process.execPath` plus the new entry file rather than the `PATH` link: the relaunch then depends on
neither the rename having been observed nor the shell's command hash.

`SG_UPGRADED_FROM` makes the child skip its own check. The guard is load-bearing, not defensive
tidiness — without it, a release whose packed version disagrees with its tag relaunches forever.
Step 4's equality check is the second, independent guard that stops such a release installing at
all. Two are warranted because a respawn loop in a TTY is not something a user can easily escape.

---

## 5. Changelog

```markdown
# Changelog

## 0.6.0 — 2026-08-14
- feat(tui): two-level repo and skill navigation in the list column
- fix(core): reproduce the candidate manifest in the git sandbox
```

Parse rule: `^## (\d+\.\d+\.\d+)` opens an entry; the body runs to the next `## ` or to EOF.

Entries are **hand-written before tagging**, and §2's assertion refuses a tag that has none.

### 5.1 Backfill

`scripts/changelog-from-history.sh`, checked in rather than run once — the precedent is
`capture-fixtures.sh`, where a derived artefact is regenerated rather than hand-edited.

1. Walk `--first-parent main --reverse`, reading `package.json` at each commit. A version boundary
   is where the version differs from the previous commit's. §1.1 is why this walk and not
   `git log -- package.json`.
2. Entry body for version V = `git log C_prev..C_V --no-merges`, filtered to `feat` / `fix` / `ui` /
   `perf` subjects.

The range and the filter together handle both commit shapes in this history. A bump-only commit
(`Version 0.3.1`) picks up the substantive commits behind it — 19 raw, 8 after filtering. A merge
commit (0.5.0) reaches into the merged branch. Filtering is what makes the entry readable: nobody
upgrading cares that a spec was compacted.

Result: 14 entries, 0.1.0 through 0.5.1.

### 5.2 How the client reads it

The changelog ships **as a release asset**, not from `raw.githubusercontent.com/main`. It is then
immutable and matched to its release, where main has usually moved past the tag and would show
entries for unreleased work. Asset downloads also do not count against the API's 60/hour.

It is fetched only when the check says `available`, and cached in `upgrade.json` **already sliced**
to the entries above the running version, so a throttled launch still shows notes with no network
call. A user two versions behind sees both entries.

```json
{
  "lastCheckedAt": "2026-08-11T09:00:00.000Z",
  "declinedVersion": null,
  "latest": {
    "version": "0.6.0",
    "publishedAt": "2026-08-14T10:00:00Z",
    "tarballUrl": "…",
    "sumsUrl": "…",
    "changelogUrl": "…",
    "releaseUrl": "…",
    "entries": [{ "version": "0.6.0", "lines": ["feat(tui): …"] }]
  }
}
```

---

## 6. Surfaces

### 6.1 Root action

After §15's existing mutation-record scan, and skipped entirely when `SG_UPGRADED_FROM` is set:

- `available` + owned → inline prompt → apply with progress lines → relaunch
- `available` + foreign → one line naming what it found and what to run instead, then the TUI
- anything else → straight to the TUI

### 6.2 `skillgantry upgrade [--yes] [--json] [--check]`

Ignores both the throttle and the decline. An explicit command answering from a cache would be
useless.

- `--check` reports only and installs nothing. **Its exit code answers "is an upgrade available"**,
  not R12.2's meaning — `fix` and `optimise`'s established divergence, for their reason: reusing
  R12.2 would make "already current" and "lookup failed" indistinguishable. `0` when the running
  version is current, `1` when a newer release exists, and a distinct code when the check could not
  be made at all.
- No `--yes` on a TTY → the same inline prompt. No `--yes` off a TTY → print, install nothing, exit
  non-zero. That is R12.4's rule for every mutating headless path.
- `--yes` applies and **does not relaunch**. `upgrade` is a command, not a session; relaunch belongs
  to the root action alone.
- `--json` prints one document rather than an event stream, as `fix` does.
- Distinct non-zero codes per class, on `suppress`'s precedent: foreign install, unreachable,
  checksum mismatch, post-install version mismatch, authorisation withheld.

### 6.3 doctor

A non-failing `skillgantry-outdated` condition beside `integrity-unverified` and `lifecycle-drift`:
names the available version and the command that installs it, and installs nothing — R3.7's
probe-and-report rule.

`src/cli/doctor-command.ts` performs the check and passes the result into the report builder as
data, exactly as it already does for the lifecycle cache, so `src/core/tools/` gains no network
dependency. It ignores the throttle and never fails the report when unreachable.

### 6.4 The prompt

`src/tui/upgrade-app.tsx` exporting `UpgradeApp`, plus
`renderUpgrade(props): Promise<'upgrade' | 'skip'>` in `src/tui/index.tsx` beside `renderSetup`,
without `alternateScreen` so the decision stays in the user's scrollback.

Props in, answer out. No filesystem, no spawn — the boundary holds, and the component is testable
through `render-ink.tsx`. Ctrl+C leaves the prompt the way it leaves every other Ink surface here:
the process exits, nothing is written, and no decline is recorded — so an interrupt is not silently
read as an answer.

```
╭─ upgrade available ──────────────────────────╮
│ 0.5.1  ->  0.6.0        released 2026-08-14  │
│                                              │
│ 0.6.0                                        │
│ - two-level repo and skill navigation        │
│ - reproduce the candidate manifest in the …  │
│                                              │
│ installs to ~/.skillgantry/versions/0.6.0    │
│ and relaunches.   y upgrade    n skip        │
╰──────────────────────────────────────────────╯
```

Apply progress prints as plain CLI lines after the prompt unmounts, in `install-cli.sh`'s register,
which the user has already seen once.

---

## 7. Migration

The ledger migrates itself when the relaunched version opens it. The rule-map migration stays
explicit and is never triggered as a side effect of an upgrade — R8.14 is unaffected by this design.

What this feature adds is narrower than a migration framework, and deliberately so: there are zero
migrations to run today, and a registry for hypothetical ones is the speculative abstraction
`CLAUDE.md` forbids. Two concrete guarantees instead:

1. **Snapshot before relink** (§4.3 step 5), so a rollback has the documents the old version wrote.
2. **A readable version error.** `loadConfig` and `loadToolLock` distinguish a version mismatch from
   any other parse failure and name which version wrote the file and what to run:

   ```
   config.json was written by a newer skillgantry (config version 2; this
   build reads 1). Upgrade with `skillgantry upgrade`, or restore
   ~/.skillgantry/backup/0.5.1/config.json.
   ```

Migration *content* stays owned by whichever future release needs it.

**One-way constraint, recorded rather than solved:** ledger schema migrations do not reverse. Rolling
back to 0.5.1 after 0.6.0 has opened the database leaves a forward-migrated schema. The snapshot
covers `config.json` and `tools/lock.json`; it does not cover the ledger, and this design does not
claim a general downgrade path.

---

## 8. Spec amendments

These are the changes that make this design a contract. Requirement ids are proposals; each must
land in `requirements.md` with a milestone owner, or `tests/specs/traceability.test.ts` fails.

| Doc | Change |
|---|---|
| `requirements.md` | **R13.8** release pipeline and its two assertions · **R13.9** CHANGELOG.md, its format, backfill and the asset · **R13.10** versioned prefixes, atomic relink, retention, ownership · **R13.11** the check: throttle, silent failure, decline, eligibility refusal · **R13.12** the apply: verify-before-adopt, snapshot, no-op on failure, relaunch guard · **R11.24** the prompt · **R12.10** `skillgantry upgrade` · a new **M12** row owning all seven |
| `design.md` | a new **§20 Version check and upgrade** · §15 gains the subcommand · §5.3 gains the `skillgantry-outdated` condition · §17 traceability rows · §18 change history |
| `design_tui.md` | **§14.13** the prompt |

M12 exit criteria, for the milestone row:

> A tag whose version disagrees with the manifest, or whose changelog section is missing, fails to
> publish; a published release carries three assets and a body extracted from the changelog. A
> client one version behind prompts once per 24 hours, shows that version's changelog entry, and
> after `n` never prompts for it again while `doctor` still reports it. A corrupt tarball, an
> unreachable API and a post-install version mismatch each leave the installation byte-identical and
> the launch unaffected. A successful upgrade relinks atomically, retains exactly the previous
> prefix, snapshots `config.json` and `tools/lock.json` first, and relaunches into the new version
> without re-checking. A binary running from a development working tree reports the new version and
> refuses to upgrade itself.

### 8.1 Pre-existing defect found while designing

`design_tui.md` carries **two sections numbered `### 14.12`** — "The repo and skill list" and "The
setup repo step". Unrelated to this work, not fixed here, recorded so it is not lost.

---

## 9. Testing

Mirrors design.md §16's target-and-guard shape.

**Unit.**

- `check` against an injected `fetchImpl`: newer, same, older; malformed JSON; 5xx; timeout;
  throttle honoured; **throttle not written on failure**; decline honoured; decline superseded by a
  higher version.
- `changelog`: parse, slice across a multi-version span, missing section, a body with no
  filterable subjects.
- `eligible`: owned under `versions/`, owned under legacy `cli/`, a development tree, an arbitrary
  foreign prefix.
- `apply` with a fixture tarball and a fake `Exec`: checksum mismatch writes nothing outside temp;
  a step-4 version mismatch leaves the link untouched; snapshot precedes relink; prune retains
  exactly two; the legacy flat directory is removed only after a successful relink.
- `upgrade-command`: exit code per class, `--check`, `--yes` off a TTY, the `--json` document shape,
  the foreign refusal.
- `upgrade-app` through `render-ink.tsx`: both answers, and notes truncation at 80×24 and 50×14.

**Acceptance**, `tests/acceptance/m12.test.ts` — the two things a unit test cannot prove, on
`m5.test.ts`'s crash-recovery precedent: a real `install-cli.sh` into a temporary `SG_HOME` upgraded
against a locally-served release, and a process killed between step 4 and step 6, asserting the
installation still works afterwards.

---

## 10. Decisions taken, with what each costs

| Decision | Cost accepted |
|---|---|
| GitHub Releases + packed tarball, not npm | An upgrade needs the GitHub API; the npm name stays unclaimed |
| Install then relaunch | One `spawnSync` and a loop guard, in exchange for the user typing `skillgantry` once |
| Snapshot and a readable error, no migration registry | The first real migration builds its own mechanism |
| 24h throttle | A release cut an hour ago may not be seen until tomorrow |
| `upgrade` command and `doctor` only; no headless note | `run` in CI never mentions a new version |
| **No opt-out** | A machine behind a blocking proxy pays the 2s timeout once per 24 hours at TUI launch, with no way to switch it off |
| Refuse on a foreign install | An `npx` user is told about a release they cannot install from here |
| Changelog hand-written | A few minutes per release, and a tag that fails to publish when it is forgotten |
