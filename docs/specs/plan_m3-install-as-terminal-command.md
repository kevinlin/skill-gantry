# Install `skillgantry` as a terminal command

## Context

SkillGantry ships as an npm package with `bin: { "skillgantry": "./dist/cli/index.js" }`, but nothing in the repo puts that binary on a PATH. Today the only way to run it is `node dist/cli/index.js` from the working tree. `tests/acceptance/packaging.test.ts` proves the packed artefact *can* be installed into a clean prefix — it just never installs it anywhere durable.

Goal: one re-runnable command that builds the current working tree and installs `skillgantry` onto the user's PATH, replacing whatever was there before.

Chicken-and-egg rules out a `skillgantry install` subcommand for the first install, so the entry point is a pnpm script over a shell script. Decisions taken with the user:

- Entry point: `pnpm run install:cli` → `scripts/install-cli.sh`.
- Runtime lands in `~/.skillgantry/cli/` (a dir SkillGantry already owns, sibling of `tools/`).
- PATH link is `~/.local/bin/skillgantry`, matching where `skill-up` and `skillspector` already live on this machine.

This is a deliberate exception to R3.1 ("never into the user's global environment"), which governs *managed tools*, not SkillGantry's own binary. Say so in the script header.

## Changes

### 1. `scripts/install-cli.sh` (new)

Match the style of the one existing script, [capture-fixtures.sh](../../scripts/capture-fixtures.sh): `#!/usr/bin/env bash`, `set -euo pipefail`, header comment stating purpose and env overrides, plain `echo` progress, non-zero exit with a message on failure.

Steps, in order:

1. **Preflight.** `node -v` major must be ≥ 24 (the `engines` floor); fail naming the found version. Require `pnpm` and `npm` on PATH.
2. **Resolve paths.** `SG_HOME="${SG_HOME:-$HOME/.skillgantry}"`, `SG_CLI_PREFIX="$SG_HOME/cli"`, `SG_BIN_DIR="${SG_BIN_DIR:-$HOME/.local/bin}"`. Both env vars overridable — this is what makes the script testable without touching the real home.
3. **Build.** `pnpm build` from the repo root (derived from `$(dirname "$0")/..`, not `$PWD`).
4. **Pack.** `pnpm pack --pack-destination "$staging"` into a `mktemp -d`; find the single `.tgz`.
5. **Wipe and install.** `rm -rf "$SG_CLI_PREFIX"`, `mkdir -p`, then `npm install --prefix "$SG_CLI_PREFIX" "$tarball"`. The wipe is what guarantees "overwrites the runtime based on the latest codebase" — it removes any chance of a stale dependency tree or a cache hit surviving a re-run.
6. **Link.** `mkdir -p "$SG_BIN_DIR"`, `ln -sfn "$SG_CLI_PREFIX/node_modules/.bin/skillgantry" "$SG_BIN_DIR/skillgantry"`. `-f` is what makes re-running idempotent; `-n` stops a second run nesting the link inside the first when the target is a directory symlink.
7. **Verify by invocation.** Run `"$SG_BIN_DIR/skillgantry" --version` and require a semver-shaped output. This is the same rule the tool installer already enforces — `verifyTool` in [install.ts:22](../../src/core/tools/install.ts#L22) refuses to write a lock entry before the binary answers. An install that produced an unrunnable binary must report failure, not success.
8. **PATH advice.** If `$SG_BIN_DIR` is not in `$PATH`, print the `export PATH="$SG_BIN_DIR:$PATH"` line for the user to add. Print it, never edit a shell rc — same posture as `INSTALL_COMMAND` in [runtimes.ts](../../src/core/tools/runtimes.ts), which is displayed for the user to run rather than executed (R3.7).
9. Final line: installed version and resolved link path.

Make the file executable (`chmod +x`).

### 2. `package.json`

Add to `scripts`:

```json
"install:cli": "scripts/install-cli.sh"
```

`install:cli` is not an npm lifecycle name (only `preinstall` / `install` / `postinstall` are), so it cannot fire implicitly.

### 3. `tests/acceptance/install-cli.test.ts` (new)

Mirrors [packaging.test.ts](../../tests/acceptance/packaging.test.ts) — same `promisify(execFile)` shape, same 180 s timeout, gated by `SG_ACCEPTANCE=1` via [vitest.config.ts](../../vitest.config.ts).

Run `scripts/install-cli.sh` with `SG_HOME` and `SG_BIN_DIR` pointed at `mkdtemp` dirs, then assert:

- `<binDir>/skillgantry --version` matches `/^\d+\.\d+\.\d+$/`.
- The link resolves into `<home>/cli/node_modules/.bin/`.
- Re-running the script succeeds and the binary still runs — the re-runnability claim, tested rather than asserted.
- The real `~/.local/bin` is untouched. Capture its state before and compare after, the same correction plan-m3 applied to the R3.1 integration assertion (asserting "the global path does not exist" tested the wrong thing on a machine that already had one).

### 4. Docs

- [design.md](design.md) §2 — the distribution paragraph currently ends at "`npm pack` output is installed into a clean temp prefix in CI". Add one sentence: local installation is `pnpm run install:cli`, which packs the working tree into `~/.skillgantry/cli` and links `~/.local/bin/skillgantry`, verified by invocation. Add a row to the §16 test-strategy table beside the existing Packaging row.
- [CLAUDE.md](../../CLAUDE.md) — add `pnpm install:cli` to the Commands block with a one-line gloss.

No requirement change: R13.5 already owns npm distribution, and this is a local install path under it, not a new product capability. Nothing in the milestone ownership table moves.

## Out of scope

- A `skillgantry install` subcommand. It would need a bootstrap anyway, and it would put an undocumented entry on the design §15 subcommand surface.
- Uninstall. Removing the link and the prefix is two `rm` calls the script's final output can name.
- `npm link` / a global npm prefix — rejected with the user: it points at the working tree, so it goes stale unless rebuilt.

## Verification

```bash
pnpm run install:cli                # build, pack, install, link, verify
skillgantry --version               # 0.1.0
skillgantry doctor                  # exercises the real binary end to end
touch src/cli/index.ts && pnpm run install:cli   # re-run overwrites cleanly
pnpm acceptance                     # includes the new install-cli test
pnpm check                          # lint, build, test, acceptance
```

Manual check worth doing once: `ls -l ~/.local/bin/skillgantry` after two consecutive runs, confirming a single symlink and no nesting.
