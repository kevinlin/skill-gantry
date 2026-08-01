import type { Runtime, ToolSpec } from './catalogue.js'
import { type Exec, defaultExec } from './exec.js'

const SEMVER = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/

export const RUNTIME_PROBE: Readonly<Record<Exclude<Runtime, 'none'>, readonly string[]>> = {
  uv: ['--version'],
  npm: ['--version'],
}

/**
 * Displayed, never run. R3.7 forbids installing a runtime without explicit
 * confirmation, and the strongest way to honour that is to own no install path.
 */
export const INSTALL_COMMAND: Readonly<Record<Exclude<Runtime, 'none'>, string>> = {
  uv: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  npm: 'install Node 24 from https://nodejs.org — npm ships with it',
}

export interface RuntimeStatus {
  runtime: Exclude<Runtime, 'none'>
  present: boolean
  version: string | null
  installCommand: string
}

export function runtimesFor(specs: readonly ToolSpec[]): readonly Runtime[] {
  return [...new Set(specs.map((spec) => spec.runtime))]
}

export async function probeRuntimes(
  needed: readonly Runtime[],
  exec: Exec = defaultExec,
): Promise<RuntimeStatus[]> {
  const wanted = [...new Set(needed)].filter(
    (runtime): runtime is Exclude<Runtime, 'none'> => runtime !== 'none',
  )
  const statuses: RuntimeStatus[] = []
  for (const runtime of wanted) {
    let version: string | null = null
    try {
      const { stdout, stderr } = await exec(runtime, RUNTIME_PROBE[runtime], { timeoutMs: 15_000 })
      version = SEMVER.exec(`${stdout}${stderr}`)?.[0] ?? null
    } catch {
      version = null
    }
    statuses.push({
      runtime,
      present: version !== null,
      version,
      installCommand: INSTALL_COMMAND[runtime],
    })
  }
  return statuses
}
