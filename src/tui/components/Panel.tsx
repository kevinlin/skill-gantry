import { Box, Text } from 'ink'

export interface PanelProps {
  /** Omitted when the panel's own first row already names it — the rail's
      stage labels and the output pane's tab strip both do. */
  title?: string
  /** Counts and state that belong beside the title, never below it. */
  hint?: string
  focused: boolean
  chrome: 'boxed' | 'bare'
  /** 0 lets the panel fill its parent. */
  width?: number
  grow?: boolean
  /** The rail owns the edge above the output pane; they share one rule. */
  borderTop?: boolean
  children: React.ReactNode
}

/**
 * One chrome decision for all four panels. `bare` drops the border and keeps
 * the title, because four bordered boxes cost fifteen rows of a stacked
 * narrow column before a single line of content.
 */
export function Panel({
  title,
  hint,
  focused,
  chrome,
  width = 0,
  grow = false,
  borderTop = true,
  children,
}: PanelProps): React.ReactElement {
  // `truncate` rather than the default wrap: a heading that wraps to two rows
  // spends a row the layout budget already allocated to content, and the panel
  // below it falls off the bottom of the terminal.
  const heading =
    title === undefined ? null : (
      <Text bold={focused} dimColor={!focused} wrap="truncate">
        <Text {...(focused ? { color: 'cyan' } : {})}>{title}</Text>
        {hint === undefined || hint.length === 0 ? null : <Text dimColor> {hint}</Text>}
      </Text>
    )

  if (chrome === 'bare') {
    return (
      <Box
        flexDirection="column"
        {...(width > 0 ? { width, flexShrink: 0 } : {})}
        {...(grow ? { flexGrow: 1 } : {})}
      >
        {heading}
        {children}
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
      borderTop={borderTop}
      paddingX={1}
      {...(width > 0 ? { width, flexShrink: 0 } : {})}
      {...(grow ? { flexGrow: 1 } : {})}
    >
      {heading}
      {children}
    </Box>
  )
}
