import { useApp } from 'ink'
import type { RepoEntry, SetupDriver } from '../core/index.js'
import { Setup } from './components/Setup.js'
import { useSetupSession } from './use-setup-session.js'

export interface SetupAppProps {
  driver: SetupDriver
  /** R3.12's registered repos, read from disk by `startSetup`. */
  repos?: readonly RepoEntry[]
}

/**
 * `skillgantry setup` is the wizard's write-through caller: its selection and
 * its repo go straight to disk, and leaving it ends the process. §14.2 renders
 * the same session inside the TUI with both of those replaced.
 */
export function SetupApp({ driver, repos = [] }: SetupAppProps): React.ReactElement {
  const { exit } = useApp()
  const session = useSetupSession({
    driver,
    repos,
    onSelection: (ids) => driver.saveSelection(ids),
    onRepo: (path, replacing) =>
      replacing === null ? driver.registerRepo(path) : driver.updateRepo(replacing, path),
    onExit: exit,
  })
  return (
    <Setup
      state={session.state}
      cursor={session.cursor}
      draftPath={session.path}
      inspection={session.inspection}
      error={session.error}
      repos={repos}
      repoCursor={session.repoCursor}
    />
  )
}
