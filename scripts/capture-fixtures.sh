#!/usr/bin/env bash
# Re-capture adapter fixtures from the pinned tool versions.
# Usage: scripts/capture-fixtures.sh /path/to/zapac-agent-skills
#
# SKILLSPECTOR_BIN overrides the executable, so fixtures can be captured from a
# SkillGantry-managed install rather than requiring the pinned version to be the
# one on the user's PATH.
set -euo pipefail

REPO="${1:?usage: capture-fixtures.sh <skills-repo>}"
PIN_SKILLSPECTOR="2.5.1"
BIN="${SKILLSPECTOR_BIN:-skillspector}"
OUT="$(dirname "$0")/../tests/fixtures/sarif"
mkdir -p "$OUT"

actual="$("$BIN" --version | awk '{print $2}' | tr -d 'v')"
if [ "$actual" != "$PIN_SKILLSPECTOR" ]; then
  echo "skillspector is $actual, fixtures are pinned to $PIN_SKILLSPECTOR" >&2
  exit 1
fi

"$BIN" scan "$REPO/declawed" --no-llm --format sarif \
  --output "$OUT/skillspector-declawed.sarif"
echo "captured $OUT/skillspector-declawed.sarif"
