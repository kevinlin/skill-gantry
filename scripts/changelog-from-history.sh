#!/usr/bin/env bash
# Derive CHANGELOG.md entries from git history.
#
# A version boundary is where `package.json`'s version differs from the
# previous commit's *along --first-parent*. Not `git log -- package.json`:
# that returns 0.5.0 older than 0.4.4, because 0.5.0 landed on a branch merged
# later, and it lists 0.4.4 at all — a version that never reached main's tip
# and was therefore never released.
#
# Usage: scripts/changelog-from-history.sh [ref]                  backfill every entry
#        scripts/changelog-from-history.sh --pending <v> [ref]    one entry for the
#                                                                 unreleased work at <ref>
#
# --pending is what `release-version.sh` seeds the new section from: the range
# is the last version-bump commit to <ref>, which is exactly the work the bump
# being cut will publish. The version is passed in because it is not on disk
# yet — inferring it here would make the script decide the bump.
set -euo pipefail

pending_version=""
if [ "${1:-}" = "--pending" ]; then
  pending_version="${2:?--pending needs a version}"
  shift 2
fi

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
    if [ -n "$prev_version" ] && [ -z "$pending_version" ]; then
      emit "$version" "$prev_commit" "$commit"
    fi
    prev_version="$version"
    prev_commit="$commit"
  fi
done < <(git log --first-parent --reverse --format=%H "$ref")

# `prev_commit` now holds the commit that introduced the version at <ref>'s tip,
# so everything after it is the unreleased work.
if [ -n "$pending_version" ]; then
  emit "$pending_version" "$prev_commit" "$ref"
fi
