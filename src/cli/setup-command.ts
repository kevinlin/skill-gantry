import { homedir } from 'node:os'
import { getAdapter } from '../core/adapters/registry.js'
import {
  CATALOGUE,
  SKILLHONE_TOOL_ID,
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
  saveToolLock,
  skillhoneSettings,
  stageToolsFor,
  updateRepo,
  writeSkillhoneSettings,
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
export function buildSetupDriver(home: string, userHome: string = homedir()): SetupDriver {
  return {
    probe: () => probeRuntimes(runtimesFor(CATALOGUE)),

    install: async (toolId) => {
      const spec = catalogueEntry(toolId)
      if (!spec) throw new Error(`not in the catalogue: ${toolId}`)
      await installTool(home, spec)
    },

    /**
     * R3.10. SkillHone is the one catalogued tool that reads its configuration
     * from a file of its own, so the id is checked here rather than declared on
     * `ToolSpec`: a field on the catalogue would be a shape for one entry, and
     * the second tool to need one is what should introduce it.
     */
    configure: async (toolId) => {
      if (toolId !== SKILLHONE_TOOL_ID) return { kind: 'skipped' }
      const env = await loadEnvFile(home)
      const settings = skillhoneSettings(env.vars)
      if (!settings) return { kind: 'no-credentials' }

      const outcome = await writeSkillhoneSettings(userHome, settings)
      if (outcome.kind !== 'written') return outcome

      // Read-modify-write of the whole lock, one tool key at a time, the same
      // shape `installTool` uses — and after the rename, so a lock recording a
      // file that was never written is not a state that exists.
      const lock = await loadToolLock(home)
      const entry = lock.tools[toolId]
      if (entry) {
        await saveToolLock(home, {
          ...lock,
          tools: {
            ...lock.tools,
            [toolId]: {
              ...entry,
              config: {
                path: outcome.path,
                sha256: outcome.sha256,
                writtenAt: new Date().toISOString(),
              },
            },
          },
        })
      }
      return outcome
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

    updateRepo: async (repoId, path) => {
      await updateRepo(home, repoId, path)
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
  // R3.12's list, read once. It cannot go stale: the wizard is a forward walk,
  // and a repo that registers or moves takes it straight to `done`.
  const { repos } = await loadConfig(options.home)
  await renderSetup({ driver: buildSetupDriver(options.home), repos })
}
