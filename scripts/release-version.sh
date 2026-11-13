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

# The version appears twice in the tarball — `package.json` and the bundled
# agent skill's `metadata.version` (design §5.5) — and two numbers for one
# artefact is a drift nobody benefits from, so they move in one edit.
#
# Replace only the version line, so the file's formatting survives — JSON
# round-tripping through node reorders nothing but reindents everything. Every
# line is found before any file is written, so a missing one leaves both files
# as they were rather than a package.json bumped past a skill that was not. The
# skill's line tolerates a quoted value, because the pin test reads it through a
# YAML parser and would pass a file this script then refused to bump.
bump_versions() {
  node -e '
    const fs = require("node:fs")
    const [current, next, mode] = process.argv.slice(1)
    const dot = current.replace(/\./g, "\\.")
    const edits = [
      ["package.json", new RegExp(`"version": "${dot}"`), () => `"version": "${next}"`],
      [
        "skills/skillgantry/SKILL.md",
        new RegExp(`^([ \\t]+version: )(["\\x27]?)${dot}\\2$`, "m"),
        (_line, lead, quote) => `${lead}${quote}${next}${quote}`,
      ],
    ]
    const planned = edits.map(([path, line, replacement]) => {
      const before = fs.readFileSync(path, "utf8")
      const after = before.replace(line, replacement)
      if (after === before) { console.error(`no version line to replace in ${path}`); process.exit(1) }
      return [path, after]
    })
    if (mode === "write") for (const [path, after] of planned) fs.writeFileSync(path, after)
  ' "$current" "$next" "$1"
}

changed="package.json, skills/skillgantry/SKILL.md and CHANGELOG.md"

if [ -n "$dry_run" ]; then
  # Checked here too: a dry run that cannot find the line is the one to say so.
  bump_versions check
  printf '%s -> %s\nwould change %s\n\n%s\n' "$current" "$next" "$changed" "$section"
  exit 0
fi

bump_versions write

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

printf '%s -> %s\nchanged %s\n\n%s\n' "$current" "$next" "$changed" "$section"
cat <<EOF
Edit the section in CHANGELOG.md — bullets are headlines, detail goes in a
paragraph under one — then:

  pnpm check
  git commit -am 'chore(release): $next'
  git tag v$next && git push origin v$next
EOF
