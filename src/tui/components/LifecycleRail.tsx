import { Box, Text } from 'ink'
import { STAGE_ORDER, type Stage } from '../../core/index.js'
import { humanMs } from '../rows.js'
import type { SkillRow, StageCell } from '../store.js'
import { ACCENT, OUTCOME_COLOUR } from '../tokens.js'
import { useTicker } from '../use-ticker.js'
import { Panel } from './Panel.js'

const LABEL: Record<Stage, string> = {
  validate: 'Validate',
  evaluate: 'Evaluate',
  security: 'Security',
  optimise: 'Optimise',
  release: 'Release',
}

/** Five full labels need ~50 cells; three-letter forms need ~25. */
const SHORT: Record<Stage, string> = {
  validate: 'Val',
  evaluate: 'Eva',
  security: 'Sec',
  optimise: 'Opt',
  release: 'Rel',
}

/**
 * Words, not glyphs. A three-cell column truncated `passed` to `pa…`, which is
 * unreadable, and a bare `●` would have made the outcome colour-only.
 */
const SHORT_OUTCOME: Record<string, string> = {
  passed: 'pass',
  failed: 'FAIL',
  errored: 'err',
  degraded: 'degr',
  skipped: 'skip',
  running: 'run',
}

/** The empty cell, in both vocabularies: no run has reached this stage. */
const NOTHING = '·'

/**
 * The column width, fixed by the vocabulary rather than by what happens to be
 * on screen. Measured from the live statuses it grew the moment the first
 * outcome landed — every stage reads `·` on an untouched skill and `degraded`
 * is eight cells — so the whole rail shifted sideways under the cursor
 * mid-batch, and the counter below would have moved it again on every tick.
 *
 * `SHORT_OUTCOME` is both halves of that vocabulary and so is read twice here:
 * its keys are the words `full` renders, its values the words `short` does. A
 * second list of the same words is how the two come to disagree.
 */
function cellWidth(short: boolean): number {
  const labels = STAGE_ORDER.map((stage) => (short ? SHORT : LABEL)[stage].length)
  const outcomes = (short ? Object.values(SHORT_OUTCOME) : Object.keys(SHORT_OUTCOME)).map(
    (word) => word.length,
  )
  return Math.max(...labels, ...outcomes) + 2
}

/** Both widths, resolved once: neither depends on anything but this module. */
const CELL_WIDTH = { full: cellWidth(false), short: cellWidth(true) }

export interface LifecycleRailProps {
  skill: SkillRow | undefined
  selected: number
  marked: readonly Stage[]
  focused: boolean
  labels?: 'full' | 'short'
  chrome?: 'boxed' | 'bare'
}

/** No title row: the stage labels are the panel's own heading. */
export function LifecycleRail({
  skill,
  selected,
  marked,
  focused,
  labels = 'full',
  chrome = 'boxed',
}: LifecycleRailProps): React.ReactElement {
  const short = labels === 'short'
  // A stage in flight counts, but only where there is room and a clock to count
  // from: `short`'s four cells hold neither `humanMs`'s output nor anything but
  // a second duration format, and a rehydrated stage is never `running`, so a
  // null `startedAt` is the live path's own guard against counting from zero.
  //
  // One expression, read by both the ticker and the cell. Written twice they
  // must agree or the rail either counts without an interval or runs an
  // interval that animates a fixed word — the case `useTicker` exists to bound.
  const now = Date.now()
  const countingMs = (state: StageCell | undefined): number | null =>
    !short && state?.running === true && state.startedAt !== null ? now - state.startedAt : null
  useTicker(STAGE_ORDER.some((stage) => countingMs(skill?.stages[stage]) !== null))

  const name = (stage: Stage): string => (short ? SHORT[stage] : LABEL[stage])
  /**
   * §14.4 taught the skill glyph to turn and the queue row to count, because a
   * stage runs for minutes and its log goes quiet for most of them — and left
   * the rail, the one panel naming the stage that is actually running, on a
   * static `running`. `windowFor` then centres the queue on the *selected* job,
   * so in a batch of twenty the counting row can be scrolled out of the panel
   * entirely and nothing on screen tells work from a hang. The rail cannot
   * scroll away; it is where the count belongs.
   *
   * `▶` is the queue's own running mark rather than a new glyph, and it is what
   * carries the state once the word is gone — paired, as every mark on this
   * screen is, but paired with a number that changes, which is a stronger claim
   * to be working than a word that sits as still as the screen around it.
   */
  const status = (stage: Stage): string => {
    const state = skill?.stages[stage]
    const ms = countingMs(state)
    if (ms !== null) return `▶ ${humanMs(ms)}`
    const raw = state?.running === true ? 'running' : (state?.outcome ?? NOTHING)
    return short ? (SHORT_OUTCOME[raw] ?? raw) : raw
  }

  // One column width for both rows, so the status always sits under its stage.
  const cell = CELL_WIDTH[labels]

  return (
    <Panel focused={focused} chrome={chrome}>
      <Box>
        {STAGE_ORDER.map((stage, index) => (
          <Box key={stage} width={cell} flexShrink={0}>
            {/* Spread rather than `color={… : undefined}`: exactOptionalPropertyTypes
                rejects an explicit undefined for an optional prop. */}
            <Text
              wrap="truncate"
              underline={index === selected}
              bold={index === selected}
              {...(marked.includes(stage) ? { color: ACCENT } : {})}
            >
              {marked.includes(stage) ? '*' : ' '}
              {name(stage)}
            </Text>
          </Box>
        ))}
      </Box>
      <Box>
        {STAGE_ORDER.map((stage) => {
          const state = skill?.stages[stage]
          // `cell` is sized from the longest status, so the text always fits.
          const colour =
            state?.running === true ? ACCENT : OUTCOME_COLOUR[state?.outcome ?? '']
          return (
            <Box key={stage} width={cell} flexShrink={0}>
              <Text wrap="truncate" {...(colour ? { color: colour } : { dimColor: true })}>
                {' '}
                {status(stage)}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Panel>
  )
}
