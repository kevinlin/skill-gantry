import { Text } from 'ink'
import type { DashboardStats } from '../../core/index.js'
import { innerWidth } from '../layout.js'
import { overviewRows } from '../rows.js'
import { Panel } from './Panel.js'

export interface OverviewProps {
  stats: DashboardStats | null
  tier: 'full' | 'compact'
  width: number
  chrome: 'boxed' | 'bare'
}

/**
 * R11.12. Unfocused always: the card is a read-only summary with no cursor, so
 * giving it a focus stop would put a stop on the Tab cycle that answers no key
 * — which is the cost R11.11 removed a stop to avoid.
 */
export function Overview({ stats, tier, width, chrome }: OverviewProps): React.ReactElement {
  const cols = Math.max(8, innerWidth(width, chrome))
  return (
    <Panel title="Overview" hint="every repo" focused={false} chrome={chrome} width={width}>
      {overviewRows(stats, tier, cols).map((row, index) => (
        <Text
          key={`${index}-${row.text}`}
          wrap="truncate"
          dimColor={row.dim === true}
          {...(row.colour === undefined ? {} : { color: row.colour })}
        >
          {row.text}
        </Text>
      ))}
    </Panel>
  )
}
