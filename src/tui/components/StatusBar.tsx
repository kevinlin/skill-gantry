import stringWidth from 'string-width'
import { Box, Text } from 'ink'
import { VERSION } from '../../core/index.js'
import { truncate } from '../layout.js'
import type { FlashTone } from '../store.js'

const LABEL = `v${VERSION}`

/**
 * `info` is the dim the hints already render in, so the footer's resting state
 * is unchanged and only a verdict claims a colour. Green and red are the same
 * two `OUTCOME_COLOUR` gives a passed and a failed stage — a run that reports
 * `failed` in the rail must not report it in a different colour one row down.
 */
const TONE: Record<Exclude<FlashTone, 'info'>, string> = { good: 'green', bad: 'red' }

/**
 * The one row every screen prints at the bottom: the keys on the left, the
 * version on the right. Eight screens each rendered their own
 * `<Text dimColor>{truncate(HINTS, columns)}</Text>`, which is how the Issues
 * footer came to omit `q quit` while `q` quit from there.
 *
 * The version rides on the row the keys already had rather than taking one of
 * its own, per §14.1's first rule. It appears only when the keys fit beside it
 * whole: truncating them to make room turns the discoverability the footer
 * exists for into `j/k move · space mark · r ru…`, which is the defect the
 * Issues footer's missing `q quit` already was. The keys are what a user cannot
 * work without; the version is what they read once.
 */
export function StatusBar({
  hints,
  columns,
  tone = 'info',
}: {
  hints: string
  columns: number
  /** Set only when `hints` is a flash; the keys themselves are always dim. */
  tone?: FlashTone
}): React.ReactElement {
  const colour = tone === 'info' ? { dimColor: true } : { color: TONE[tone] }
  const fits = stringWidth(hints) + LABEL.length + 1 <= columns
  if (!fits) return <Text {...colour}>{truncate(hints, columns)}</Text>
  return (
    <Box width={columns} justifyContent="space-between">
      <Text {...colour} wrap="truncate">
        {hints}
      </Text>
      <Text dimColor>{LABEL}</Text>
    </Box>
  )
}
