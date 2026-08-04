import { getAdapter } from '../core/adapters/registry.js'
import {
  CATALOGUE,
  catalogueEntry,
  inspectRepo,
  installTool,
  loadConfig,
  loadEnvFile,
  loadToolLock,
  probeRuntimes,
  registerRepo,
  runtimesFor,
  saveConfig,
  stageToolsFor,
  type SetupDriver,
} from '../core/index.js'
import { renderSetup } from '../tui/index.js'

export interface SetupOptions {
  home: string
}

/** A clean machine has no repo and no locked tool. */
export async function needsSetup(home: string): Promise<boolean> {
  const [config, lock] = await Promise.all([loadConfig(home), loadToolLock(home)])
  return config.repos.length === 0 && Object.keys(lock.tools).length === 0
}

/**
 * The single place config, the lockfile, the install drivers and the credential
 * file meet — the same role `tui-command.ts` plays for the Work screen, and the
 * reason `src/tui/**` needs neither subprocess nor sqlite.
 */
export function buildSetupDriver(home: string): SetupDriver {
  return {
    probe: () => probeRuntimes(runtimesFor(CATALOGUE)),

    install: async (toolId) => {
      const spec = catalogueEntry(toolId)
      if (!spec) throw new Error(`not in the catalogue: ${toolId}`)
      await installTool(home, spec)
    },

    saveSelection: async (selected) => {
      const config = await loadConfig(home)
      await saveConfig(home, {
        ...config,
        stageTools: stageToolsFor(selected, (id) => getAdapter(id) !== undefined),
      })
    },

    credentialStatus: async () => {
      const env = await loadEnvFile(home)
      return { present: env.present, warnings: env.warnings }
    },

    inspectRepo: (path) => inspectRepo(home, path),

    registerRepo: async (path) => {
      await registerRepo(home, path)
    },

    installedTools: async () => {
      const lock = await loadToolLock(home)
      // Verified, not merely present: an entry that will not run is exactly what
      // doctor calls `unverifiable`, and reinstalling it is the right answer.
      return Object.entries(lock.tools)
        .filter(([, entry]) => entry.verifiedAt !== null)
        .map(([id]) => id)
    },
  }
}

export async function startSetup(options: SetupOptions): Promise<void> {
  await renderSetup({ driver: buildSetupDriver(options.home) })
}
