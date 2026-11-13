import { homedir } from 'node:os'
import { getAdapter } from '../core/adapters/registry.js'
import {
  CATALOGUE,
  PRESETS,
  SKILLHONE_TOOL_ID,
  catalogueEntry,
  expandSelection,
  inspectRepo,
  installTool,
  loadConfig,
  loadEnvFile,
  loadToolLock,
  missingRuntimesFor,
  probeRuntimes,
  registerRepo,
  runtimesFor,
  saveConfig,
  saveToolLock,
  skillhoneSettings,
  stageToolsFor,
  updateRepo,
  writeSkillhoneSettings,
  type PresetName,
  type SetupDriver,
} from '../core/index.js'
import { renderSetup } from '../tui/index.js'
import { oneLine } from './errors.js'
import type { CliDeps } from './run-command.js'

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
      // `userHome` is where a `git-skill` links its bundle. Left out, the driver
      // took the parameter for `configure` alone and every install fell back to
      // `os.homedir()`, so a run under a temporary SG_HOME still linked into the
      // real `~/.claude/skills`.
      await installTool(home, spec, { userHome })
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
      //
      // Installed *at the pin this build ships*, too. The lock records what was
      // requested when the tool was installed, and the wizard skips whatever
      // this returns — so an entry pinned to an older version would answer
      // "already installed" forever and a catalogue bump would reach new
      // machines only. Nothing else notices: doctor compares the binary with
      // the lock, and those two agree with each other while both trail the
      // catalogue.
      return Object.entries(lock.tools)
        .filter(
          ([id, entry]) =>
            entry.verifiedAt !== null && entry.requestedPin === catalogueEntry(id)?.install.pin,
        )
        .map(([id]) => id)
    },
  }
}

export interface HeadlessSetupOptions {
  yes?: boolean
  preset?: string
  json?: boolean
}

type ToolState = 'installed' | 'present' | 'failed' | 'would-install'

/** Design §15.1's `setup --yes --preset` document. */
export interface SetupDocument {
  preset: PresetName
  /** The stage selection was written: every tool of the install set is usable. */
  applied: boolean
  runtimes: Array<{ runtime: string; present: boolean; installCommand: string }>
  tools: Array<{ id: string; state: ToolState; error?: string; config?: string }>
  credentials: { present: boolean; warnings: string[] }
}

/**
 * `Object.hasOwn`, not `in` or a lookup: `PRESETS['toString']` is a function,
 * and a name that merely resolves on the prototype is not a preset.
 */
function presetOf(opts: HeadlessSetupOptions): PresetName {
  const names = Object.keys(PRESETS)
  if (opts.preset === undefined) {
    throw new Error(
      `--yes needs --preset <${names.join('|')}>: ` +
        'choosing tools stage by stage is a conversation, and the wizard is where it is held',
    )
  }
  if (!Object.hasOwn(PRESETS, opts.preset)) {
    throw new Error(`unknown preset "${opts.preset}": expected one of ${names.join(', ')}`)
  }
  return opts.preset as PresetName
}

/**
 * R12.18: the wizard's forward walk with nobody walking it, over the same
 * `SetupDriver`, so the headless path and the wizard cannot install
 * differently. `installAll` in `use-setup-session.ts` is the sequence mirrored:
 * skip what is installed, attempt the rest, configure what is usable.
 *
 * Resolves to the exit code: `0` when the selection was written, `1` when it was
 * not — a dry run, or a tool that did not install. A request that cannot be
 * carried out throws, and `main()` turns it into `2`.
 */
export async function runSetupHeadless(deps: CliDeps, opts: HeadlessSetupOptions): Promise<number> {
  const preset = presetOf(opts)
  const driver = (deps.setupDriver ?? buildSetupDriver)(deps.home, deps.userHome)
  const selection = PRESETS[preset]
  const installSet = expandSelection(selection)

  // Refused with or without `--yes`: a dry run that reported `would-install`
  // for a machine that cannot install it would be a plan that fails on
  // execution. R3.7 never installs a runtime, so the check is not a choice.
  const runtimes = await driver.probe()
  const missing = missingRuntimesFor(installSet, runtimes)
  if (missing.length > 0) {
    throw new Error(
      `the ${preset} preset needs a runtime this machine lacks, and setup never installs one: ` +
        `${missing.map((status) => `${status.runtime} (${status.installCommand})`).join('; ')}; ` +
        'install it, then run this again. Nothing was installed',
    )
  }

  const already = new Set(await driver.installedTools())
  const tools: SetupDocument['tools'] = installSet.map((id) => ({
    id,
    state: already.has(id) ? 'present' : 'would-install',
  }))

  if (opts.yes === true) {
    // In order and to the end: each tool is its own download, so one failing
    // says nothing about the next.
    for (const tool of tools) {
      if (tool.state !== 'would-install') continue
      try {
        await driver.install(tool.id)
        tool.state = 'installed'
      } catch (err) {
        tool.state = 'failed'
        tool.error = err instanceof Error ? err.message : String(err)
      }
    }
    // R3.10, after every install rather than inside the loop, as the wizard
    // does: composing a tool's configuration reads the credential file. Its
    // outcome is reported and is never a failure — `no-credentials` is a fact
    // about an `.env` this command does not write.
    for (const tool of tools) {
      if (tool.state === 'failed') continue
      const outcome = await driver.configure(tool.id)
      if (outcome.kind !== 'skipped') tool.config = outcome.kind
    }
  }

  const credentials = await driver.credentialStatus()
  // Only when every tool is usable. A partial selection would deselect a tool
  // that failed to move to a new pin while its old install still runs, and the
  // wizard cannot leave its install step in that state either.
  const applied = opts.yes === true && tools.every((tool) => tool.state !== 'failed')
  if (applied) await driver.saveSelection(selection)

  const document: SetupDocument = {
    preset,
    applied,
    runtimes: runtimes.map(({ runtime, present, installCommand }) => ({ runtime, present, installCommand })),
    tools,
    credentials: { present: credentials.present, warnings: [...credentials.warnings] },
  }
  if (opts.json === true) {
    deps.write(JSON.stringify(document))
  } else {
    for (const tool of tools) {
      deps.write(
        `${tool.id}  ${tool.state}` +
          (tool.error === undefined ? '' : `  ${oneLine(tool.error)}`) +
          (tool.config === undefined ? '' : `  config: ${tool.config}`),
      )
    }
    deps.write(
      `credentials  ${credentials.present ? 'present' : 'absent'}` +
        credentials.warnings.map((warning) => `  warning: ${oneLine(warning)}`).join(''),
    )
  }
  return applied ? 0 : 1
}

export async function startSetup(options: SetupOptions): Promise<void> {
  // R3.12's list, read once. It cannot go stale: the wizard is a forward walk,
  // and a repo that registers or moves takes it straight to `done`.
  const { repos } = await loadConfig(options.home)
  await renderSetup({ driver: buildSetupDriver(options.home), repos })
}
