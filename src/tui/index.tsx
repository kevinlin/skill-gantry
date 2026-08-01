import { render } from 'ink'
import { App, type AppProps } from './app.js'
import { SetupApp, type SetupAppProps } from './setup-app.js'

/** Resolves when the user quits. The caller owns the queue and the ledger. */
export async function renderApp(props: AppProps): Promise<void> {
  const instance = render(<App {...props} />)
  await instance.waitUntilExit()
}

/** Resolves when the user leaves the wizard. The caller owns the driver. */
export async function renderSetup(props: SetupAppProps): Promise<void> {
  const instance = render(<SetupApp {...props} />)
  await instance.waitUntilExit()
}

export type { AppProps } from './app.js'
export type { SetupAppProps } from './setup-app.js'
