import { type Exec, defaultExec } from '../tools/exec.js'

/**
 * Both sandbox strategies need all three. `git` is not only the worktree
 * strategy's: the snapshot strategy renders its preview with
 * `git diff --no-index`, so a non-git repo needs the binary even though it has
 * no repository.
 */
export const MUTATION_COMMANDS: readonly string[] = ['git', 'zip', 'unzip']

/**
 * No single flag probes all three: Info-ZIP `unzip` (the default on macOS and
 * Debian/Ubuntu) has no `--version` long option and mis-parses it as a file
 * argument, exiting 10 even when the binary is present. `-v` is the argv that
 * actually answers for it.
 */
const VERSION_ARGV: Record<string, readonly string[]> = {
  git: ['--version'],
  zip: ['--version'],
  unzip: ['-v'],
}

/**
 * Checked once, before a sandbox is opened. Discovering a missing `zip`
 * after the tool has written the live tree would leave a mutation that can be
 * neither packaged nor reviewed, with the marker already claiming it is active.
 */
export async function requireCommands(
  commands: readonly string[],
  exec: Exec = defaultExec,
): Promise<void> {
  for (const command of commands) {
    try {
      await exec(command, VERSION_ARGV[command] ?? ['--version'], { timeoutMs: 10_000 })
    } catch {
      throw new Error(`mutating stage needs ${command} on PATH`)
    }
  }
}
