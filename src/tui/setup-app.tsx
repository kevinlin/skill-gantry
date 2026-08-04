import { useApp } from 'ink'
import type { SetupDriver } from '../core/index.js'
import { Setup } from './components/Setup.js'
import { useSetupSession } from './use-setup-session.js'

export interface SetupAppProps {
  driver: SetupDriver
}

/**
 * `skillgantry setup` is the wizard's write-through caller: its selection and
 * its repo go straight to disk, and leaving it ends the process. §14.2 renders
 * the same session inside the TUI with both of those replaced.
 */
export function SetupApp({ driver }: SetupAppProps): React.ReactElement {
  const { exit } = useApp()
  const session = useSetupSession({
    driver,
    onSelection: (ids) => driver.saveSelection(ids),
    onRepo: (entry) => driver.registerRepo(entry.path),
    onExit: exit,
  })
  return (
    <Setup
      state={session.state}
      cursor={session.cursor}
      draftPath={session.path}
      inspection={session.inspection}
      error={session.error}
    />
  )
}
