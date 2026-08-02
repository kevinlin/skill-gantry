import type { ChangeSet } from '../isolation/types.js'
import type { PendingMutation, StageContext } from './types.js'

/**
 * The change set a pending mutation was built from. It travels beside the
 * `PendingMutation` rather than inside it because `PendingMutation` crosses the
 * event stream to a frontend, and a frontend has no use for preimage hashes —
 * while `apply` cannot do without them, since R10.11's recheck compares against
 * the values captured when the diff was built.
 */
const CHANGE_SETS = new WeakMap<PendingMutation, ChangeSet>()

export function rememberChangeSet(pending: PendingMutation, change: ChangeSet): PendingMutation {
  CHANGE_SETS.set(pending, change)
  return pending
}

export function changeSetFor(pending: PendingMutation): ChangeSet {
  const change = CHANGE_SETS.get(pending)
  if (!change) throw new Error('no change set recorded for this pending mutation')
  return change
}

/** Null means the tools changed nothing, so there is nothing to approve. */
export async function prepareFromSandbox(ctx: StageContext): Promise<PendingMutation | null> {
  if (!ctx.sandbox) return null
  const change = await ctx.sandbox.changeSet()
  if (change.entries.length === 0) return null
  return rememberChangeSet(
    {
      diff: change.unifiedDiff,
      scope: change.entries.map((entry) => entry.path),
    },
    change,
  )
}

export async function applyFromSandbox(
  ctx: StageContext,
  pending: PendingMutation,
): Promise<void> {
  if (!ctx.sandbox) throw new Error('applyMutation called with no sandbox')
  await ctx.sandbox.apply(changeSetFor(pending))
}

export async function discardFromSandbox(ctx: StageContext): Promise<void> {
  await ctx.sandbox?.discard()
}
