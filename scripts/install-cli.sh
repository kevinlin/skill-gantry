#!/usr/bin/env bash
# Install `skillgantry` from this working tree onto the user's PATH.
# Usage: pnpm run install:cli
#
# Re-runnable: this version's prefix is wiped and reinstalled every time, so
# the command on PATH always reflects the current source. A cached tarball or a
# stale dependency tree cannot survive a re-run.
#
# SG_HOME    overrides ~/.skillgantry  (the CLI lands in $SG_HOME/versions/<v>)
# SG_BIN_DIR overrides ~/.local/bin        (where the symlink is written)
# Both exist so the acceptance test can install without touching a real home.
#
# One prefix per version, adopted by an atomic rename, matching the upgrade
# path (design §20) so the layout has one author rather than two that drift.
#
# R3.1 forbids installing *managed tools* into the user's global environment.
# SkillGantry's own binary is the deliberate exception: a tool manager that
# cannot be invoked is unusable, and the link is a single owned path.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SG_HOME="${SG_HOME:-$HOME/.skillgantry}"
SG_BIN_DIR="${SG_BIN_DIR:-$HOME/.local/bin}"
version="$(node -p 'require("'"$ROOT"'/package.json").version')"
CLI_PREFIX="$SG_HOME/versions/$version"
LINK="$SG_BIN_DIR/skillgantry"

for cmd in node pnpm npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "$cmd is not on PATH" >&2; exit 1; }
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 24 ]; then
  echo "node $(node -v) is below the >=24.0.0 engine floor" >&2
  exit 1
fi

echo "build      $ROOT"
pnpm --dir "$ROOT" build

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
pnpm --dir "$ROOT" pack --pack-destination "$staging" >/dev/null
tarball="$(find "$staging" -maxdepth 1 -name '*.tgz' -print -quit)"
[ -n "$tarball" ] || { echo "pnpm pack produced no tarball" >&2; exit 1; }
echo "pack       $(basename "$tarball")"

# This version's prefix only. A sibling version is what the upgrade path
# retains for a rollback, so wiping the whole versions root here would delete
# it on every re-install.
rm -rf "$CLI_PREFIX"
mkdir -p "$CLI_PREFIX"
npm install --prefix "$CLI_PREFIX" "$tarball" >/dev/null
echo "install    $CLI_PREFIX"

mkdir -p "$SG_BIN_DIR"
# One atomic rename, matching the upgrade path (design §20): `ln -sfn` unlinks
# before it symlinks, leaving a window with no command on PATH.
rm -f "$LINK.$$.tmp"
ln -s "$CLI_PREFIX/node_modules/.bin/skillgantry" "$LINK.$$.tmp"
mv -f "$LINK.$$.tmp" "$LINK"
echo "link       $LINK"

# Verify by invocation, the same rule verifyTool applies to managed tools: an
# install that produced an unrunnable binary must report failure, not success.
version="$("$LINK" --version 2>&1 | tr -d '[:space:]')"
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "installed binary did not answer --version with a semver: $version" >&2
  exit 1
fi

echo "verify     skillgantry $version"

# Retention is exactly two — current and previous — so a rollback is a rename
# rather than a reinstall. `sort -V` orders versions rather than strings, so
# 0.10.0 does not prune as older than 0.9.0.
pruned=0
while read -r stale; do
  [ -n "$stale" ] || continue
  rm -rf "$SG_HOME/versions/$stale"
  pruned=$((pruned + 1))
done < <(ls -1 "$SG_HOME/versions" 2>/dev/null | sort -Vr | tail -n +3)
[ "$pruned" -eq 0 ] || echo "prune      $pruned older prefix(es)"

# The flat prefix predates the versioned layout. The link no longer resolves
# through it, so removing it now is safe.
if [ -d "$SG_HOME/cli" ]; then
  rm -rf "$SG_HOME/cli"
  echo "prune      legacy $SG_HOME/cli"
fi

case ":$PATH:" in
  *":$SG_BIN_DIR:"*) ;;
  *)
    echo
    echo "$SG_BIN_DIR is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"$SG_BIN_DIR:\$PATH\""
    ;;
esac

echo
echo "skillgantry $version installed at $LINK"
echo "to remove:  rm -f \"$LINK\" && rm -rf \"$SG_HOME/versions\""
