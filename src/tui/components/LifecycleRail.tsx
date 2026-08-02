import { Box, Text } from 'ink'
import { STAGE_ORDER, type Stage } from '../../core/index.js'
import type { SkillRow } from '../store.js'
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

const OUTCOME_COLOUR: Record<string, string> = {
  passed: 'green',
  failed: 'red',
  errored: 'yellow',
  degraded: 'yellow',
  skipped: 'gray',
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
  const name = (stage: Stage): string => (short ? SHORT[stage] : LABEL[stage])
  const status = (stage: Stage): string => {
    const state = skill?.stages[stage]
    const raw = state?.running === true ? 'running' : (state?.outcome ?? '·')
    return short ? (SHORT_OUTCOME[raw] ?? raw) : raw
  }

  // One column width for both rows, so the status always sits under its stage,
  // and wide enough for whichever of the two is longer.
  const cell =
    Math.max(...STAGE_ORDER.flatMap((stage) => [name(stage).length, status(stage).length])) + 2

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
              {...(marked.includes(stage) ? { color: 'cyan' } : {})}
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
            state?.running === true ? 'cyan' : OUTCOME_COLOUR[state?.outcome ?? '']
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
