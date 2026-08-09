import { Box, Text } from 'ink'
import { innerWidth, reviewDiffRows, truncate, truncateMiddle, type Layout } from '../layout.js'
import type { ReleaseSlot } from '../store.js'
import { STATUS } from '../tokens.js'
import { Panel } from './Panel.js'
import { StatusBar } from './StatusBar.js'

const HINTS = 'enter release · tab field · space toggle · esc cancel'

/**
 * R11.19. The one surface that supplies R9.10's target, and the reason a
 * release can be started from the terminal at all: `releaseTarget` has no
 * default and the engine refuses to invent one, so without this pane the run
 * key could only ever enqueue a job that fails in the first stage.
 *
 * A form rather than a diff — the diff is `ReviewPane`, one stage later, after
 * the target has produced something to show.
 */
export function ReleaseTargetPane({
  release,
  layout,
}: {
  release: ReleaseSlot
  layout: Layout
}): React.ReactElement {
  const cols = Math.max(8, innerWidth(layout.columns, layout.chrome))
  const batched = release.skillIds.length > 1

  // §14.1's first rule: every conditional row is counted *against* the budget
  // before the list is sized, never appended under it. The uncommitted paths
  // are the only unbounded content here, so they are what gives way.
  const fixed =
    2 + (release.error === null ? 0 : 1) + (batched ? 1 : 0) + (release.dirty.length > 0 ? 1 : 0)
  const room = Math.max(0, reviewDiffRows(layout) - fixed)
  const overflow = release.dirty.length > room
  const shown = overflow ? release.dirty.slice(0, Math.max(0, room - 1)) : release.dirty
  const hidden = release.dirty.length - shown.length

  const only = release.skillIds[0]
  const current = batched ? null : (only === undefined ? null : release.refs[only]?.version) ?? null
  const title = batched
    ? `Release — ${release.skillIds.length} skills`
    : `Release — ${truncateMiddle(only ?? '', Math.max(12, cols - 28))} · current ${current ?? 'none'}`

  // The resolution, not just the input: `minor` is an explicit choice under
  // R9.10 only if the user can see which number it names before pressing enter.
  const target =
    release.version.trim() === ''
      ? ''
      : release.resolved === null
        ? release.version
        : `${release.version} → ${release.resolved}`

  return (
    <Box flexDirection="column" width={layout.columns}>
      <Panel title={title} focused chrome={layout.chrome} width={layout.columns}>
        <Text wrap="truncate" inverse={release.field === 'version'}>
          {truncate(`target  ${target}`, cols)}
        </Text>
        <Text wrap="truncate" inverse={release.field === 'notes'}>
          {truncate(`notes   ${release.notes}`, cols)}
        </Text>
        {batched && (
          <Text dimColor wrap="truncate">
            {truncate('a bump level applies to each skill from its own version', cols)}
          </Text>
        )}
        {release.dirty.length > 0 && (
          <Text
            color={STATUS.warn}
            wrap="truncate"
            inverse={release.field === 'dirty'}
          >
            {truncate(
              `[${release.allowDirty ? 'x' : ' '}] override ${release.dirty.length} uncommitted path(s)` +
                (release.allowDirty
                  ? ' — your bytes are staged and reversible'
                  : ' — release will refuse'),
              cols,
            )}
          </Text>
        )}
        {shown.map((path) => (
          <Text key={path} dimColor wrap="truncate">
            {truncate(`  ${path}`, cols)}
          </Text>
        ))}
        {hidden > 0 && (
          <Text dimColor wrap="truncate">
            {truncate(`  +${hidden} more`, cols)}
          </Text>
        )}
        {release.error !== null && (
          <Text color={STATUS.bad} wrap="truncate">
            {truncate(release.error, cols)}
          </Text>
        )}
      </Panel>
      <StatusBar hints={HINTS} columns={layout.columns} />
    </Box>
  )
}
