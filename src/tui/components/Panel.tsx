import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { ACCENT, STATUS } from '../tokens.js'
import { truncate } from '../layout.js'

interface PanelCommon {
  focused: boolean
  chrome: 'boxed' | 'bare'
  grow?: boolean
  /** The rail owns the edge above the output pane; they share one rule. */
  borderTop?: boolean
  children: React.ReactNode
}

/**
 * `width` is required with a title and optional without, because a titled boxed
 * panel draws its heading row and its box in two independent renders: one cell
 * of disagreement puts the `┐` a column away from the `│` under it, which reads
 * as a torn frame rather than as a layout bug. Making it a type error is why
 * the compiler catches the next call site instead of a user catching it.
 */
export type PanelProps = PanelCommon &
  (
    | {
        title: string
        /** Counts and state that belong beside the title, never below it. */
        hint?: string
        width: number
      }
    | { title?: undefined; hint?: undefined; width?: number }
  )

/**
 * One chrome decision for all four panels. `bare` drops the border and keeps
 * the title as a row, because four bordered boxes cost fifteen rows of a
 * stacked narrow column before a single line of content — and because there is
 * no border there to embed a heading in.
 */
export function Panel(props: PanelProps): React.ReactElement {
  const { focused, chrome, grow = false, borderTop = true, children } = props
  const title = props.title
  const hint = props.hint
  const width = props.width ?? 0

  const label =
    title === undefined ? null : (
      <>
        <Text bold={focused} {...(focused ? { color: ACCENT } : {})}>
          {title}
        </Text>
        {hint === undefined || hint.length === 0 ? null : <Text dimColor> {hint}</Text>}
      </>
    )

  if (chrome === 'bare') {
    return (
      <Box
        flexDirection="column"
        {...(width > 0 ? { width, flexShrink: 0 } : {})}
        {...(grow ? { flexGrow: 1 } : {})}
      >
        {/* `truncate` rather than the default wrap: a heading that wraps to two
            rows spends a row the budget allocated to content, and the panel
            below it falls off the bottom of the terminal. */}
        {label === null ? null : <Text wrap="truncate">{label}</Text>}
        {children}
      </Box>
    )
  }

  const borderColour = focused ? ACCENT : STATUS.muted
  // `┌─ title hint ───┐` is `┌`, `─`, a space, the label, a space, the run of
  // `─`, and `┐` — five cells that are never the label, so the fill is whatever
  // the label did not take. Floored at 0 rather than 1: a floor of one made a
  // 12-cell panel need 13 cells, which is §14.1's first rule broken by the
  // chrome that exists to obey it.
  //
  // Cell-measured, not `.length`. One code unit of disagreement puts the `┐` a
  // column off the `│` under it, which is the torn frame the required `width`
  // exists to prevent — and a CJK title is two cells per unit.
  const furniture = 5
  const labelRoom = Math.max(0, width - furniture)
  const shownTitle = title === undefined ? '' : truncate(title, labelRoom)
  const shownHint =
    hint === undefined || hint.length === 0
      ? ''
      : truncate(hint, Math.max(0, labelRoom - stringWidth(shownTitle) - 1))
  const used =
    stringWidth(shownTitle) + (shownHint.length === 0 ? 0 : stringWidth(shownHint) + 1)
  const fill = Math.max(0, width - used - furniture)

  return (
    <Box flexDirection="column" {...(width > 0 ? { width, flexShrink: 0 } : {})}>
      {borderTop && title !== undefined && (
        <Text wrap="truncate">
          <Text color={borderColour}>┌─ </Text>
          <Text bold={focused} {...(focused ? { color: ACCENT } : {})}>
            {shownTitle}
          </Text>
          {shownHint.length === 0 ? null : <Text dimColor> {shownHint}</Text>}
          <Text color={borderColour}>{` ${'─'.repeat(fill)}┐`}</Text>
        </Text>
      )}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={borderColour}
        // The heading row above *is* this box's top edge when there is a title.
        borderTop={borderTop && title === undefined}
        paddingX={1}
        {...(width > 0 ? { width, flexShrink: 0 } : {})}
        {...(grow ? { flexGrow: 1 } : {})}
      >
        {children}
      </Box>
    </Box>
  )
}
