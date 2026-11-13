import { type IssueAction, listIssues, openLedger, setIssueState } from '../core/index.js'
import type { CliDeps } from './run-command.js'

export interface IssueOptions {
  json?: boolean
}

/**
 * A record, not an array, so that a fourth `IssueAction` is a type error here
 * until the command knows its name — a union member this list forgot would be
 * refused as "unknown" by the one command meant to apply it.
 */
const ACTIONS: Readonly<Record<IssueAction, true>> = { acknowledge: true, wontfix: true, reopen: true }

const isAction = (value: string): value is IssueAction => Object.hasOwn(ACTIONS, value)

/**
 * R12.17. `setIssueState` answers `null` for a transition §10.5 forbids and for
 * a fingerprint it has never seen, which the Issues screen could not tell apart
 * and did not need to. A command has to: `1` is "it ran and the answer was no"
 * and `2` is "the request was bad" (R12.13), so the issue is read first and an
 * unknown fingerprint — like an unknown action — throws to `main()`'s handler.
 *
 * The action is checked before the ledger is opened, so a request that can
 * never be carried out does not create or migrate a database to find that out.
 * Both documents carry the state the issue is in *now*: the exit code, and not
 * the shape, says whether it moved. It writes the ledger alone, and prints no
 * interrupted-mutation notice for the reason `list` and `status` do not: that
 * line would land on the stream a caller parses as one document.
 */
export async function runIssue(
  deps: CliDeps,
  fingerprint: string,
  action: string,
  opts: IssueOptions,
): Promise<number> {
  if (!isAction(action)) {
    throw new Error(`unknown action "${action}": use ${Object.keys(ACTIONS).join(', ')}`)
  }

  const ledger = openLedger(deps.dbPath)
  try {
    const issue = listIssues(ledger.db, {}).find((row) => row.fingerprint === fingerprint)
    if (issue === undefined) throw new Error(`no issue has fingerprint ${fingerprint}`)

    const moved = setIssueState(ledger.db, fingerprint, action)
    const state = moved ?? issue.state
    if (opts.json === true) {
      deps.write(JSON.stringify({ fingerprint, state }))
    } else if (moved === null) {
      deps.write(`${fingerprint}  ${state}: ${action} is not a legal transition from ${state}`)
    } else {
      deps.write(`${fingerprint}  ${state}`)
    }
    return moved === null ? 1 : 0
  } finally {
    ledger.close()
  }
}
