import { Box, Text } from 'ink'
import type { ConfigChange } from '../../core/index.js'
import { innerWidth, screenBodyRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import { Panel } from './Panel.js'

const GLYPH: Record<ConfigChange['kind'], string> = { add: '+', remove: '-', change: '~' }
const COLOUR: Record<ConfigChange['kind'], string> = {
  add: 'green',
  remove: 'red',
  change: 'yellow',
}

/**
 * R11.8 in the terminal: the change set is what the user authorises, and it is
 * field-level rather than textual because a line diff of a JSON document reports
 * an array edit as a block move. Sized from the layout like every other pane,
 * and the overflow notice is counted *against* the allocation rather than
 * appended below it — §14.1's first rule.
 */
export function ConfirmPane({
  changes,
  configPath,
  offset,
  layout,
}: {
  changes: readonly ConfigChange[]
  configPath: string
  offset: number
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  // Two rows spent on the footer and the restart notice, so the window is what
  // is left rather than the whole budget.
  const height = Math.max(1, screenBodyRows(layout) - 2)
  const start = Math.min(offset, Math.max(0, changes.length - height))
  const shown = changes.slice(start, Math.min(changes.length, start + height))
  const hidden = changes.length - shown.length
  // Removing a repo takes it out of the config and nothing else; without saying
  // so, "remove" over a path reads as a delete of the directory it names.
  const removesRepo = changes.some(
    (change) => change.kind === 'remove' && change.path.startsWith('repos['),
  )

  return (
    <Panel
      title={`Confirm — ${truncateMiddle(configPath, Math.max(8, cols - 12))}`}
      hint={`${changes.length} change${changes.length === 1 ? '' : 's'}`}
      focused
      chrome={layout.chrome}
    >
      {shown.map((change, index) => (
        <Text key={`${start + index}`} wrap="truncate" color={COLOUR[change.kind]}>
          {truncate(
            `${GLYPH[change.kind]} ${change.path.padEnd(28)} ${
              change.kind === 'add'
                ? (change.after ?? '')
                : change.kind === 'remove'
                  ? (change.before ?? '')
                  : `${change.before ?? ''} → ${change.after ?? ''}`
            }`,
            cols,
          )}
        </Text>
      ))}
      <Text dimColor wrap="truncate">
        {truncate(
          removesRepo
            ? 'takes effect on the next launch · workspaces and recorded runs are kept'
            : 'every change takes effect on the next launch',
          cols,
        )}
      </Text>
      <Box>
        <Text wrap="truncate">
          {truncate(
            `a apply · d discard · j/k scroll${hidden > 0 ? ` · ${hidden} hidden` : ''}`,
            cols,
          )}
        </Text>
      </Box>
    </Panel>
  )
}
