import { Text } from 'ink'
import { truncate } from '../layout.js'
import { ACCENT, STATUS } from '../tokens.js'

/**
 * Diff gutters through the shared vocabulary rather than the three ANSI names
 * a diff conventionally uses: these are the panes whose `a` writes the user's
 * repo, so an added line reading green in whatever the terminal profile calls
 * green — beside a rail rendering `passed` as `#00c853` — is exactly where a
 * colour has to mean what it means everywhere else. The hunk header takes
 * `ACCENT` for the reason `Panel`'s focused border does: it is the mark saying
 * where to look. One renderer for both panes, because two is the divergence
 * `tokens.ts` records from when five modules each owned severity colour.
 */
const colour = (line: string): string | undefined =>
  line.startsWith('+')
    ? STATUS.ok
    : line.startsWith('-')
      ? STATUS.bad
      : line.startsWith('@@')
        ? ACCENT
        : undefined

/**
 * The rows a diff occupies, and how many it could not show. Returned as a pair
 * rather than rendering the footnote itself, because §14.1 counts that footnote
 * against the caller's allocation and the two panes spend it differently.
 */
export function diffRows(
  diff: string,
  offset: number,
  height: number,
  width: number,
): { rows: React.ReactElement[]; hidden: number } {
  const lines = diff.split('\n')
  // Clamped so the last window is a full one: clamping to the last line left a
  // single diff line on screen at the bottom of a long diff.
  const start = Math.min(offset, Math.max(0, lines.length - height))
  const shown = lines.slice(start, start + height)
  return {
    rows: shown.map((line, index) => {
      const lineColour = colour(line)
      return (
        <Text
          key={`${start + index}`}
          wrap="truncate"
          {...(lineColour === undefined ? {} : { color: lineColour })}
        >
          {truncate(line, width)}
        </Text>
      )
    }),
    hidden: lines.length - shown.length,
  }
}
