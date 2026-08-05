import stringWidth from 'string-width'

/**
 * Below this the Work screen cannot show a skill list, a five-stage rail and a
 * readable pane at once, so it says so rather than rendering a shredded frame.
 */
export const MIN_COLUMNS = 50
export const MIN_ROWS = 14

/** Two columns stop fitting here: the rail alone needs ~50 cells. */
const NARROW_BELOW = 76
const WIDE_FROM = 110

/**
 * The list column on a wide terminal. A fixed 26 cells truncated most skill
 * names to `architecture-dia…` on a 240-column window that had cells to spare,
 * so wide mode spends a share of its width on the list instead. The cap stops
 * the column from eating the pane on an ultrawide: past it, extra width buys
 * log text, not more room for names that already fit.
 */
const WIDE_LIST_SHARE = 0.18
const WIDE_LIST_MAX = 34

/**
 * Rows spent on chrome before any content, per layout.
 *
 * boxed — header, footer, the queue box's border and title, the rail box, and
 * the output pane's tab row plus the bottom border it shares with the rail.
 * bare  — header, footer, one title row per panel, the rail's two rows, and the
 * output pane's tab row. Four bordered boxes cost 15 rows in a stacked column,
 * which left nothing for content in a 60x20 split, so narrow drops the borders
 * and separates panels by their titles instead.
 */
const BOXED_CHROME = 11
const BARE_CHROME = 8

/**
 * Cells `Panel`'s boxed chrome takes out of a row: two border columns plus its
 * `paddingX={1}` on each side. It lives here rather than in each pane because
 * three components re-deriving `width - 4` meant a change to Panel's padding
 * silently truncated every label to the wrong width.
 */
const PANEL_INSET = 4

/** The width a panel's children actually get, net of its chrome. */
export function innerWidth(width: number, chrome: 'boxed' | 'bare'): number {
  return width - (chrome === 'boxed' ? PANEL_INSET : 0)
}

/** Rows the review frame spends before its first diff line: chrome, scope, footer. */
const REVIEW_CHROME_ROWS = { boxed: 6, bare: 4 } as const

/**
 * Diff lines the review pane can show. Floored at 0, not 1: a floor of one row
 * made the frame need one row more than it had below five, which is §14.1's
 * first rule broken. Lives here rather than in `ReviewPane` because the scroll
 * clamp needs the same number — without it, `j` at the bottom of a diff walked
 * `offset` to the last line and left a one-line pane.
 */
export function reviewDiffRows(layout: Layout): number {
  return Math.max(0, layout.rows - REVIEW_CHROME_ROWS[layout.chrome] - 1)
}

/**
 * Rows a full-screen view spends before its first body row: the panel's chrome
 * and title, plus the footer hint the screen prints below it. Same shape as
 * `REVIEW_CHROME_ROWS` and Help's, and here rather than in four components for
 * §14.1's third rule — three panes each re-deriving their own chrome cost is
 * how a panel falls off the bottom when `Panel`'s padding changes.
 */
const SCREEN_CHROME_ROWS = { boxed: 4, bare: 2 } as const

export function screenBodyRows(layout: Layout): number {
  return Math.max(1, layout.rows - SCREEN_CHROME_ROWS[layout.chrome] - 1)
}

export type LayoutMode = 'too-small' | 'narrow' | 'standard'

export interface Layout {
  mode: LayoutMode
  columns: number
  rows: number
  /** Boxes when there is room for them, titles alone when there is not. */
  chrome: 'boxed' | 'bare'
  /** 0 when the list is stacked above the rail rather than beside it. */
  skillListWidth: number
  /** Skill rows visible at once; the rest scroll under the selection. */
  skillRows: number
  outputHeight: number
  queueRows: number
  /** `Validate` vs `Val` — the rail is the first thing to overflow. */
  stageLabels: 'full' | 'short'
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

/**
 * Every pane height is derived from the real terminal, because the previous
 * fixed 12-row log plus 5-row queue rendered 26 rows into an 80x24 window and
 * scrolled its own header away.
 */
export function layoutFor(columns: number, rows: number): Layout {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return {
      mode: 'too-small',
      columns,
      rows,
      chrome: 'bare',
      skillListWidth: 0,
      skillRows: 0,
      outputHeight: 0,
      queueRows: 0,
      stageLabels: 'short',
    }
  }

  const narrow = columns < NARROW_BELOW
  const skillListWidth = narrow
    ? 0
    : columns >= WIDE_FROM
      ? clamp(Math.floor(columns * WIDE_LIST_SHARE), 26, WIDE_LIST_MAX)
      : 22
  const queueRows = clamp(Math.floor((rows - MIN_ROWS) / 6) + 1, 1, 4)
  const budget = rows - (narrow ? BARE_CHROME : BOXED_CHROME) - queueRows

  // Stacked, the list competes with the pane for the same column of rows.
  // Beside the rail it competes with nothing, so it takes the height the right
  // column already defines and no more — a taller left box grows the flex row.
  const skillRows = narrow ? clamp(Math.floor(budget / 3), 1, 6) : 0
  const outputHeight = Math.max(3, budget - skillRows)

  return {
    mode: narrow ? 'narrow' : 'standard',
    columns,
    rows,
    chrome: narrow ? 'bare' : 'boxed',
    skillListWidth,
    skillRows: narrow ? skillRows : outputHeight + 2,
    outputHeight,
    queueRows,
    // Five full labels plus their gutters need 50 cells inside the rail's
    // border and padding; below that they shatter mid-word.
    stageLabels: (narrow ? columns : columns - skillListWidth) >= 54 ? 'full' : 'short',
  }
}

/** Wide enough for the longest runtime install command, and no wider. */
const SETUP_MAX_WIDTH = 84

/**
 * The wizard is inline, not a session: stretching its frame across a 200
 * column terminal to hold six lines of text is chrome for its own sake. It
 * never exceeds the terminal either, so a narrow window does not get a frame
 * wider than itself with every row wrapped.
 */
export function setupWidth(columns: number): number {
  return Math.min(columns, SETUP_MAX_WIDTH)
}

/**
 * Tail truncation with a reserved ellipsis cell. Measured in cells rather than
 * code units, so a CJK skill name cannot overflow its column by its own width.
 */
/**
 * Right-pads to a *cell* count, not a code-unit count. `padEnd` counts units,
 * so a CJK skill name — two cells per character — was padded to half the column
 * it needed and every value to its right sat one place left of the row above.
 */
export function padCells(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - stringWidth(text)))
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (stringWidth(text) <= width) return text
  if (width === 1) return '…'
  // Widths accumulate rather than re-measuring the growing prefix: at 100
  // columns that was ~50 `stringWidth` passes per line, on every line of a log
  // pane that re-renders every 100 ms while a tool streams.
  let out = ''
  let used = 0
  for (const char of text) {
    const cells = stringWidth(char)
    if (used + cells > width - 1) break
    out += char
    used += cells
  }
  return `${out}…`
}

/**
 * Head-elided truncation, for paths whose basename is what identifies them.
 * Cell-measured like `truncate`, because artefact paths come from user repos
 * and a wide character would otherwise spill past the pane's right edge.
 */
export function truncateMiddle(text: string, width: number): string {
  if (stringWidth(text) <= width || width < 8) return truncate(text, width)
  // One cell of the budget is the leading ellipsis.
  const budget = Math.floor(width * 0.6)
  const chars = [...text]
  let out = ''
  let used = 1
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const char = chars[i] as string
    const cells = stringWidth(char)
    if (used + cells > budget) break
    out = char + out
    used += cells
  }
  return `…${out}`
}

/**
 * The visible slice of a list longer than its pane, always containing the
 * selection. Without this a 20-skill repo pushed the queue off the screen.
 */
export function windowFor(
  total: number,
  selected: number,
  height: number,
): { start: number; end: number } {
  if (height >= total) return { start: 0, end: total }
  const start = Math.min(Math.max(0, selected - Math.floor(height / 2)), total - height)
  return { start, end: start + height }
}
