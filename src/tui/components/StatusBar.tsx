import { createContext, useContext } from 'react'
import stringWidth from 'string-width'
import { Box, Text } from 'ink'
import { VERSION } from '../../core/index.js'
import { truncate } from '../layout.js'
import type { FlashTone } from '../store.js'
import { STATUS } from '../tokens.js'

const LABEL = `v${VERSION}`

/**
 * The home the footer names beside the version — null for the default, which
 * says nothing. A context because nine components draw this bar and none of
 * them knows anything a home is; threading a string through all of them to
 * reach the one row they share is the divergence `StatusBar` was extracted to
 * end. Provided once, at the root of `App`.
 */
export const HomeLabelContext = createContext<string | null>(null)

/**
 * `info` is the dim the hints already render in, so the footer's resting state
 * is unchanged and only a verdict claims a colour. The two tones are the same
 * two `OUTCOME_COLOUR` gives a passed and a failed stage — a run that reports
 * `failed` in the rail must not report it in a different colour one row down.
 * Spelled `'green'` and `'red'` that was exactly what happened: the rail
 * resolved `#00c853` while this row resolved whatever the terminal profile
 * called green, for one run, one row apart.
 */
const TONE: Record<Exclude<FlashTone, 'info'>, string> = { good: STATUS.ok, bad: STATUS.bad }

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
/**
 * R11.9's flash takes the footer's row rather than adding one, on every screen
 * that can raise one. Work was the only screen that rendered it, so a refusal
 * raised anywhere else — `q` with a change set staged, say — was invisible, and
 * a refusal the user cannot read is worse than the key doing nothing.
 */
export function footer(
  state: { flash: string | null; flashTone: FlashTone },
  hints: string,
): { hints: string; tone: FlashTone } {
  return {
    hints: state.flash ?? hints,
    tone: state.flash === null ? 'info' : state.flashTone,
  }
}

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
  const home = useContext(HomeLabelContext)
  const colour = tone === 'info' ? { dimColor: true } : { color: TONE[tone] }
  // One label, measured whole. A home is a path and can be long, and a version
  // kept after the home was cut would read as the whole label — the user who
  // launched against a non-default home would see `v1.1.0` and take it for the
  // default one, which is the one thing this label exists to prevent.
  const label = home === null ? LABEL : `${LABEL} · ${home}`
  const fits = stringWidth(hints) + stringWidth(label) + 1 <= columns
  if (!fits) return <Text {...colour}>{truncate(hints, columns)}</Text>
  return (
    <Box width={columns} justifyContent="space-between">
      <Text {...colour} wrap="truncate">
        {hints}
      </Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}
