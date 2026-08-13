/**
 * `sha256sum <name>` writes the name bare, `sha256sum -b <name>` prefixes it
 * with `*`, and `sha256sum ./<name>` — what a shell glob expands to — writes
 * `./<name>`. A matcher that knew only the first two forms read SkillGantry's
 * own release asset as "no entry for this asset", so no upgrade published
 * before 0.6.5 could verify its download. One parser, so a producer that
 * changes form cannot break one consumer and not the other.
 */
function bareName(name: string): string {
  return name.replace(/^[*]/, '').replace(/^\.\//, '')
}

/** The hex digest recorded for `assetName`, or null when the file omits it. */
export function digestFor(sums: string, assetName: string): string | null {
  const line = sums
    .split('\n')
    .map((raw) => raw.trim().split(/\s+/))
    .find((parts) => parts[1] !== undefined && bareName(parts[1]) === assetName)
  return line?.[0] ?? null
}
