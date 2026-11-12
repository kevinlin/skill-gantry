import { errorDocument, oneLine } from './errors.js'
import { type CliDeps, buildProgram, containCommander, isCommanderError } from './run-command.js'

/**
 * commander ends a `--help`, `help` or `--version` through the same throw it
 * uses for a parse error, so under `exitOverride` the three arrive as errors
 * and have to be told apart by code. A person asked for those outputs, which
 * makes them successes — but only when the error also carries exit code 0:
 * `commander.help` is the code for a requested help screen and for a parent
 * command given no subcommand, which commander answers with usage and exit 1.
 */
const SUCCESS_CODES: ReadonlySet<string> = new Set([
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
])

/**
 * Scanned from argv rather than read from a parsed option, because the one case
 * that needs it most — a parse error — is the case where nothing was parsed.
 * Stops at `--`, past which every token is an operand.
 */
function wantsJson(argv: readonly string[]): boolean {
  for (const token of argv.slice(2)) {
    if (token === '--') return false
    if (token === '--json') return true
  }
  return false
}

const debugging = (): boolean => {
  const flag = process.env['SG_DEBUG']
  return flag !== undefined && flag !== '' && flag !== '0'
}

/**
 * R12.13. `1` is reserved for a command that ran and whose answer was no, so
 * everything that could not be carried out — an unknown skill, a bad option, a
 * missing prerequisite — is `2`, as one line and no stack.
 */
function report(err: unknown, json: boolean, deps: Required<Pick<CliDeps, 'write' | 'writeErr'>>): number {
  if (isCommanderError(err)) {
    if (SUCCESS_CODES.has(err.code) && err.exitCode === 0) return 0
    // commander printed its own line before throwing; printing again would put
    // the same sentence on stderr twice.
    if (json) deps.write(errorDocument(err.message.replace(/^error: /, '')))
    return 2
  }

  const message = err instanceof Error ? err.message : String(err)
  deps.writeErr(`error: ${oneLine(message)}`)
  if (json) deps.write(errorDocument(message))
  // The stack is for whoever is debugging skillgantry itself. An agent reading
  // it would take a frame for an instruction.
  if (debugging() && err instanceof Error && err.stack !== undefined) deps.writeErr(err.stack)
  return 2
}

/**
 * The bin entry, exported so it is testable without a spawn. Resolves to the
 * exit code and never throws; never calls `process.exit`, so a caller that
 * embeds it keeps its own process.
 *
 * The handler lives here and not in `buildProgram` or an action. Tests drive
 * the program in-process and assert on the rejection, and a program that
 * swallowed its own errors would turn every one of those into a pass.
 */
export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const writeErr = deps.writeErr ?? ((line: string) => console.error(line))
  const io = { write: deps.write, writeErr }
  try {
    const program = buildProgram({
      ...deps,
      writeErr,
      // Filled in here and not in the actions: an in-process caller that
      // injects `startTui` is a caller that has already decided there is a
      // terminal, and must not be refused for what vitest's stdin is.
      stdinIsTTY: deps.stdinIsTTY ?? process.stdin.isTTY === true,
    })
    containCommander(program, io)
    await program.parseAsync(argv)
    return program.exitCode ?? 0
  } catch (err) {
    try {
      return report(err, wantsJson(argv), io)
    } catch {
      // Printing failed (a closed pipe, say). The request still could not be
      // carried out, and a resolved 2 is more use to the caller than a throw.
      return 2
    }
  }
}
