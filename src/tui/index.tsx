import { render } from 'ink'
import { App, type AppProps } from './app.js'
import { SetupApp, type SetupAppProps } from './setup-app.js'

/**
 * Resolves when the user quits. The caller owns the queue and the ledger.
 *
 * The Work screen is a session the user lives in, so it takes the alternate
 * screen: the shell's scrollback survives the run instead of being buried under
 * however many frames the queue produced.
 */
export async function renderApp(props: AppProps): Promise<void> {
  const instance = render(<App {...props} />, { alternateScreen: true })
  await instance.waitUntilExit()
}

/** Resolves when the user leaves the wizard. The caller owns the driver. */
export async function renderSetup(props: SetupAppProps): Promise<void> {
  const instance = render(<SetupApp {...props} />)
  await instance.waitUntilExit()
}

export type { AppProps } from './app.js'
export type { SetupAppProps } from './setup-app.js'
