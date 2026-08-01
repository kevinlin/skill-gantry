import { render } from 'ink'
import { App, type AppProps } from './app.js'

/** Resolves when the user quits. The caller owns the queue and the ledger. */
export async function renderApp(props: AppProps): Promise<void> {
  const instance = render(<App {...props} />)
  await instance.waitUntilExit()
}

export type { AppProps } from './app.js'
