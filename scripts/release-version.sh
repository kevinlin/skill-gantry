#!/usr/bin/env bash
# Cut a version: bump `package.json` and open its CHANGELOG.md section, seeded
# from the commits since the last bump.
#
# It stops there. Committing, tagging and pushing stay manual, because the tag
# is what publishes (`.github/workflows/release.yml`) and the seeded section is
# a draft — design_version-check-and-upgrade.md §5 requires each bullet to read
# as a headline within one terminal row, which derived commit subjects are not.
#
# Usage: scripts/release-version.sh [patch|minor|major] [--dry-run]   (default: patch)
set -euo pipefail

cd "$(dirname "$0")/.."

level="patch"
dry_run=""
for arg in "$@"; do
  case "$arg" in
    patch|minor|major) level="$arg" ;;
    --dry-run) dry_run=1 ;;
    *) echo "usage: scripts/release-version.sh [patch|minor|major] [--dry-run]" >&2; exit 2 ;;
  esac
done

# A dirty tree would mix uncommitted work into the release commit the user makes
# next, and the seeded section only describes what is committed.
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; commit or stash first" >&2
  exit 1
fi

current="$(node -p 'require("./package.json").version')"
next="$(node -e '
  const [version, level] = process.argv.slice(1)
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) { console.error(`package.json version is not x.y.z: ${version}`); process.exit(1) }
  let [major, minor, patch] = m.slice(1).map(Number)
  if (level === "major") { major++; minor = 0; patch = 0 }
  else if (level === "minor") { minor++; patch = 0 }
  else patch++
  process.stdout.write(`${major}.${minor}.${patch}`)
' "$current" "$level")"

if grep -q "^## $next " CHANGELOG.md; then
  echo "CHANGELOG.md already has a '## $next' section" >&2
  exit 1
fi

section="$(scripts/changelog-from-history.sh --pending "$next" HEAD)"
# No `feat`/`fix`/`ui`/`perf` subject behind the bump. The release workflow still
# demands a section, and 0.4.3 is the precedent for what an empty one says.
if ! printf '%s' "$section" | grep -q '^- '; then
  section="$(printf '## %s — %s\n- No user-facing change.\n' "$next" "$(date +%F)")"
fi

if [ -n "$dry_run" ]; then
  printf '%s -> %s\n\n%s\n' "$current" "$next" "$section"
  exit 0
fi

# Replace only the version line, so the file's formatting survives — JSON
# round-tripping through node reorders nothing but reindents everything.
node -e '
  const fs = require("node:fs")
  const [current, next] = process.argv.slice(1)
  const path = "package.json"
  const before = fs.readFileSync(path, "utf8")
  const after = before.replace(`"version": "${current}"`, `"version": "${next}"`)
  if (after === before) { console.error(`no version line to replace in ${path}`); process.exit(1) }
  fs.writeFileSync(path, after)
' "$current" "$next"

# Insert above the newest section, i.e. after the preamble, keeping newest-first.
node -e '
  const fs = require("node:fs")
  const section = process.argv[1]
  const path = "CHANGELOG.md"
  const text = fs.readFileSync(path, "utf8")
  const at = text.indexOf("\n## ")
  if (at === -1) { console.error(`${path} has no '"'"'## '"'"' section to insert above`); process.exit(1) }
  const head = text.slice(0, at + 1)
  fs.writeFileSync(path, `${head}${section.trimEnd()}\n\n${text.slice(at + 1)}`)
' "$section"

printf '%s -> %s\n\n%s\n' "$current" "$next" "$section"
cat <<EOF
Edit the section in CHANGELOG.md — bullets are headlines, detail goes in a
paragraph under one — then:

  pnpm check
  git commit -am 'chore(release): $next'
  git tag v$next && git push origin v$next
EOF
