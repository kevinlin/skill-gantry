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

for skill in declawed architecture-diagram; do
  "$BIN" scan "$REPO/$skill" --no-llm --format sarif \
    --output "$OUT/skillspector-$skill.sarif"
  echo "captured $OUT/skillspector-$skill.sarif"
done

PIN_SKILL_SCANNER="0.3.3"
SCAN_BIN="${SKILL_SCANNER_BIN:-skill-scanner}"

# skill-scanner has no static mode: --no-ai --no-vt exits with "No analyzers
# enabled". The fixture is therefore an LLM-mode capture and needs a key. It is
# skipped rather than failed when none is set, so a contributor without a key
# can still refresh every other fixture.
if [ -n "${SKILLSCAN_API_KEY:-}${SKILLSCAN_BASE_URL:-}" ]; then
  scan_actual="$("$SCAN_BIN" --version | tr -d 'v')"
  if [ "$scan_actual" != "$PIN_SKILL_SCANNER" ]; then
    echo "skill-scanner is $scan_actual, fixtures are pinned to $PIN_SKILL_SCANNER" >&2
    exit 1
  fi
  # insight-profile rather than declawed: this is an LLM judgement, and the
  # model reports declawed, agent-insights and rfp-daily CLEAN. insight-profile
  # drives an SSO session and shells out, so it is the reference repo's one
  # skill that reliably produces findings to map.
  #
  # Its findings are nondeterministic, so a re-capture will not reproduce this
  # file byte for byte. The parse test asserts what the parser does with these
  # bytes, never that a re-run yields them again.
  "$SCAN_BIN" scan --path "$REPO/insight-profile" --no-vt --format sarif \
    --output "$OUT/skill-scanner-insight-profile.sarif"
  echo "captured $OUT/skill-scanner-insight-profile.sarif"
else
  echo "skipping skill-scanner: set SKILLSCAN_API_KEY or SKILLSCAN_BASE_URL to capture it" >&2
fi

PIN_SKILL_LINT="0.2.0"
LINT_BIN="${SKILL_LINT_BIN:-skill-lint}"
LINT_OUT="$(dirname "$0")/../tests/fixtures/skill-lint"
mkdir -p "$LINT_OUT"

lint_actual="$("$LINT_BIN" --version | tr -d 'v')"
if [ "$lint_actual" != "$PIN_SKILL_LINT" ]; then
  echo "skill-lint is $lint_actual, fixtures are pinned to $PIN_SKILL_LINT" >&2
  exit 1
fi

for skill in architecture-diagram zuhlke-slides; do
  # skill-lint exits 1 on WARN and 2 on TOXIC, which are findings rather than
  # failures, so a non-zero exit here must not abort the capture.
  "$LINT_BIN" "$REPO/$skill" --json > "$LINT_OUT/$skill.json" || true
  echo "captured $LINT_OUT/$skill.json"
done

UP_OUT="$(dirname "$0")/../tests/fixtures/skill-up"
mkdir -p "$UP_OUT"

# skill-up run needs an Agent Engine and spends real model budget, so these are
# copied from the reference repo's own iterations rather than re-run. The schema
# version is asserted here, which is the property the parser is pinned to.
for it in 1 3; do
  src="$REPO/declawed-workspace/iteration-$it/report.json"
  ver="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['schema_version'])" "$src")"
  if [ "$ver" != "v1alpha1" ]; then
    echo "iteration-$it report is $ver, the parser is pinned to v1alpha1" >&2
    exit 1
  fi
  cp "$src" "$UP_OUT/declawed-iteration-$it.report.json"
  echo "captured $UP_OUT/declawed-iteration-$it.report.json"
done
