import { render } from 'ink'
import { App, type AppProps } from './app.js'
import { SetupApp, type SetupAppProps } from './setup-app.js'
import { UpgradeApp, type UpgradeAppProps } from './upgrade-app.js'

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

/**
 * Resolves with the answer. No `alternateScreen`, matching `renderSetup`: the
 * decision the user just made stays in their scrollback, which is where the
 * apply progress lines land after this unmounts (§14.13).
 */
export async function renderUpgrade(
  props: Omit<UpgradeAppProps, 'onAnswer'>,
): Promise<'upgrade' | 'skip'> {
  return new Promise((resolve) => {
    const instance = render(
      <UpgradeApp
        {...props}
        onAnswer={(answer) => {
          instance.unmount()
          resolve(answer)
        }}
      />,
    )
  })
}

export type { AppProps } from './app.js'
export type { SetupAppProps } from './setup-app.js'
export { UpgradeApp } from './upgrade-app.js'
export type { UpgradeAppProps } from './upgrade-app.js'
