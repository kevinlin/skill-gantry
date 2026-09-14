#!/usr/bin/env bash
# Re-capture adapter fixtures from the pinned tool versions.
# Usage: scripts/capture-fixtures.sh /path/to/zapac-agent-skills
#
# SKILLSPECTOR_BIN overrides the executable, so fixtures can be captured from a
# SkillGantry-managed install rather than requiring the pinned version to be the
# one on the user's PATH.
set -euo pipefail

REPO="${1:?usage: capture-fixtures.sh <skills-repo>}"
PIN_SKILLSPECTOR="2.11.2"
BIN="${SKILLSPECTOR_BIN:-skillspector}"
OUT="$(dirname "$0")/../tests/fixtures/sarif"
mkdir -p "$OUT"

actual="$("$BIN" --version | awk '{print $2}' | tr -d 'v')"
if [ "$actual" != "$PIN_SKILLSPECTOR" ]; then
  echo "skillspector is $actual, fixtures are pinned to $PIN_SKILLSPECTOR" >&2
  exit 1
fi

# architecture-diagram carries the ordinary finding set. The second subject is
# there for AE1 alone — the coverage notice 2.10.0 added, which the adapter
# declares as `coverageRuleIds` and must therefore keep a capture of. declawed
# was the first subject through 2.5.1 and scans clean under this pin, so it
# would now be a fixture asserting nothing.
for skill in architecture-diagram claude-code-usage-report-suggestions; do
  "$BIN" scan "$REPO/$skill" --no-llm --format sarif \
    --output "$OUT/skillspector-$skill.sarif"
  echo "captured $OUT/skillspector-$skill.sarif"
done

# R4.15. The other half of a pair: architecture-diagram scanned *with* its own
# baseline, so a diff test can assert that --baseline annotates rather than
# drops. Its unbaselined half is the capture the loop above just wrote, one
# command earlier against the same tree, so the two are comparable byte for byte
# — the reason the subject is one already captured here rather than a third.
#
# The subject also has to be one with no finding located on the baseline file
# itself: passing `--baseline <file>` drops any finding reported against that
# file, so a subject like spec-lint yields halves of different lengths and the
# diff reports upstream drift that is not there.
PAIR_SKILL="architecture-diagram"
BASELINE="$REPO/$PAIR_SKILL/.skillspector-baseline.yaml"
if [ -f "$BASELINE" ]; then
  "$BIN" scan "$REPO/$PAIR_SKILL" --no-llm --format sarif \
    --output "$OUT/skillspector-$PAIR_SKILL-baselined.sarif" --baseline "$BASELINE"
  echo "captured $OUT/skillspector-$PAIR_SKILL-baselined.sarif"
else
  echo "skipping the baseline pair: $BASELINE is absent" >&2
fi

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
