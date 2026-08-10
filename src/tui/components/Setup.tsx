import { Box, Text, useWindowSize } from 'ink'
import { setupBodyRows, setupWidth, truncate } from '../layout.js'
import { ACCENT, STATUS } from '../tokens.js'
import {
  CATALOGUE,
  SETUP_ORDER,
  missingRuntimesFor,
  type ConfigureOutcome,
  type RepoEntry,
  type RepoInspection,
  type SetupState,
  type SetupStateName,
} from '../../core/index.js'

/**
 * One entry per step, so a new wizard state cannot get a heading without also
 * getting the rail label that has to stay in step with it. `short` is short
 * enough that five of them and their separators fit 60 columns.
 */
const STEPS: Record<SetupStateName, { title: string; short: string }> = {
  'probe-runtimes': { title: 'Runtimes', short: 'Runtimes' },
  'select-tools': { title: 'Select tools', short: 'Tools' },
  'install-and-verify': { title: 'Install and verify', short: 'Install' },
  'credentials-and-repo': { title: 'Credentials and repo', short: 'Repo' },
  done: { title: 'Done', short: 'Done' },
}

const MARK: Record<string, string> = { pending: '·', installing: '◐', ok: '●', failed: '×' }

/**
 * R3.10's outcome as a trailing field on the tool's own row, beside the
 * existing `failed —` precedent, so the step costs exactly the rows it was
 * allocated. It names the path and never the document: the file holds the
 * user's credential, and a wizard that echoed it would put a secret on screen
 * and in every scrollback the inline wizard deliberately leaves behind.
 */
function configField(outcome: ConfigureOutcome): { text: string; tone: string } | null {
  switch (outcome.kind) {
    case 'written':
      return { text: '~/.skillhone/settings.json written', tone: STATUS.ok }
    case 'exists':
      return { text: '~/.skillhone/settings.json exists — left alone', tone: STATUS.warn }
    case 'no-credentials':
      return { text: 'no ANTHROPIC_AUTH_TOKEN in ~/.skillgantry/.env', tone: STATUS.warn }
    case 'skipped':
      return null
  }
}

/**
 * The visible slice of a list that must keep `cursor` on screen, and how many
 * rows it hid. The footnote costs one of the rows, per §14.1's first rule, so
 * an overflowing list shows one fewer entry rather than one more row.
 */
function listWindow(
  total: number,
  cursor: number,
  budget: number,
): { from: number; to: number; hidden: number } {
  const room = Math.max(1, budget)
  if (total <= room) return { from: 0, to: total, hidden: 0 }
  const shown = Math.max(1, room - 1)
  const from = Math.min(Math.max(0, cursor - shown + 1), total - shown)
  return { from, to: from + shown, hidden: total - shown }
}

export interface SetupProps {
  state: SetupState
  cursor: number
  /** What the user has typed but not yet submitted. */
  draftPath?: string
  inspection?: RepoInspection | null
  error?: string | null
  /** R3.12: what is already registered, from whichever caller owns the config. */
  repos?: readonly RepoEntry[]
  /** Indexes `[...repos, <register another>]`; `repos.length` is that slot. */
  repoCursor?: number
  /**
   * What `q` does for this caller. `skillgantry setup` ends the process; the
   * same wizard inside a session returns to Settings, and a footer that
   * promised "quit" there described a key that does something else.
   */
  exitLabel?: string
}

/**
 * Never colour alone: every state also differs in glyph and in weight.
 *
 * The step the user is on takes `ACCENT`, which is what §14 makes the focus
 * signal everywhere else — a focused panel border, the selected output tab, the
 * cursor. Written as `'cyan'` it was the one place in the interface where "look
 * here" was a fourth colour, resolved by the terminal's profile rather than by
 * this module.
 */
function StepRail({ current }: { current: SetupStateName }): React.ReactElement {
  const at = SETUP_ORDER.indexOf(current)
  return (
    <Box>
      {SETUP_ORDER.map((step, index) => {
        const done = index < at
        const here = index === at
        return (
          <Box key={step} marginRight={1}>
            <Text
              color={done ? STATUS.ok : here ? ACCENT : STATUS.muted}
              bold={here}
              dimColor={!done && !here}
            >
              {done ? '●' : here ? '▸' : '○'} {STEPS[step].short}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * Rows this step spends outside the registered list: the credentials line, the
 * two blanks that separate the blocks, the list's own heading, the field, and
 * the verdict's two. The list is the only unbounded content here, so it is what
 * gives way — §14.1's first rule, applied to a step that until R3.12 had
 * nothing to window.
 *
 * The verdict's two are reserved whether or not anything is typed. A list that
 * reflowed on the first keystroke is the frame shifting under the cursor that
 * §14.4 records the cost of, and the field is there to be typed into.
 */
const REPO_FIXED_ROWS = 7

/**
 * Below this the list cannot be drawn at all: `listWindow` spends one row on
 * its own footnote, so two is the least that shows one entry and admits to the
 * rest. At 50×14 the step's fixed rows already fill its allocation.
 */
const REPO_LIST_MIN = 2

function RepoStep({
  state,
  draftPath,
  inspection,
  repos,
  repoCursor,
  body,
}: {
  state: SetupState
  draftPath: string
  inspection: RepoInspection | null
  repos: readonly RepoEntry[]
  repoCursor: number
  body: number
}): React.ReactElement {
  const typed = draftPath.length > 0
  const warnings = state.credentials?.warnings ?? []
  // The trailing slot is `+ register another`, so adding is a position rather
  // than a mode and one `enter` handler serves both.
  const slots = repos.length + 1
  const budget = body - REPO_FIXED_ROWS - warnings.length
  const showList = repos.length > 0 && budget >= REPO_LIST_MIN
  const window = listWindow(slots, repoCursor, budget)
  const idWidth = Math.max(0, ...repos.map((repo) => repo.id.length))
  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>credentials </Text>
        {state.credentials?.present ? (
          <Text color={STATUS.ok}>~/.skillgantry/.env found</Text>
        ) : (
          <Text color={STATUS.warn}>no .env yet</Text>
        )}
      </Text>
      {warnings.map((warning) => (
        <Text key={warning} color={STATUS.warn}>
          {'  '}
          {warning}
        </Text>
      ))}

      {/* One row where the block will not fit, rather than nothing: the cursor
          still moves and still prefills the field, and a list that vanished
          silently would make both read as a broken key. */}
      {repos.length > 0 && !showList && (
        <Text dimColor wrap="truncate">
          {repos.length} registered · ↑/↓ choose
        </Text>
      )}

      {/* Absent on a clean machine, which keeps that frame exactly what it was. */}
      {showList && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>registered</Text>
          {Array.from({ length: window.to - window.from }, (_, offset) => {
            const index = window.from + offset
            const repo = repos[index]
            const here = index === repoCursor
            return (
              <Text key={repo?.id ?? '+'} wrap="truncate">
                {here ? '▸' : ' '}{' '}
                {repo ? (
                  <>
                    {repo.id.padEnd(idWidth)} <Text dimColor>{repo.isGit ? 'git   ' : 'no git'}</Text>{' '}
                    {repo.path}
                  </>
                ) : (
                  <Text dimColor>+ register another</Text>
                )}
              </Text>
            )
          })}
          {window.hidden > 0 && (
            <Text dimColor>
              {'  '}
              {window.hidden} more · ↑/↓
            </Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>repo path </Text>
        {/* The cursor block is what makes an empty field look focused rather
            than inert — without it the screen read as frozen while typing. */}
        <Text>
          {draftPath}
          <Text inverse> </Text>
        </Text>
        {!typed && <Text dimColor> type or paste a path, ~ is expanded</Text>}
      </Box>

      {typed && inspection && (
        <Verdict inspection={inspection} selected={repos[repoCursor] ?? null} />
      )}
    </Box>
  )
}

function Verdict({
  inspection,
  selected,
}: {
  inspection: RepoInspection
  selected: RepoEntry | null
}): React.ReactElement {
  const { resolved, isDirectory, alreadyRegistered, skillCount } = inspection
  // The path under the cursor is registered by definition, so the duplicate
  // rule would report a prefilled field as broken before the user typed
  // anything. The list answers which repo holds it, so `RepoInspection` needs
  // no id: a boolean widened into one would be a second home for that rule.
  const own = selected !== null && selected.path === resolved
  return (
    <Box flexDirection="column">
      <Text dimColor>{'          → '}{resolved}</Text>
      <Text>
        {'          '}
        {!isDirectory ? (
          <Text color={STATUS.bad}>error: no such directory</Text>
        ) : alreadyRegistered && !own ? (
          <Text color={STATUS.bad}>error: already registered</Text>
        ) : own ? (
          <Text dimColor>unchanged</Text>
        ) : skillCount === 0 ? (
          <Text color={STATUS.warn}>warning: no skills found here — enter registers it anyway</Text>
        ) : (
          <Text color={STATUS.ok}>
            {skillCount} skill{skillCount === 1 ? '' : 's'} found
          </Text>
        )}
      </Text>
    </Box>
  )
}

/**
 * Three phrasings rather than one truncated superset: §14.1's footer rule
 * refuses to cut the row that names the keys, and `enter register` and `enter
 * save` are different promises anyway. With no repos there is nothing to
 * choose between, so that row is exactly what it always was.
 */
function repoHint(repoCount: number, repoCursor: number): string {
  if (repoCount === 0) return 'enter register · esc back · ctrl-d finish without a repo'
  return repoCursor >= repoCount
    ? 'enter register · ↑/↓ choose · esc back · ctrl-d finish'
    : 'enter save · ↑/↓ choose · esc back · ctrl-d finish'
}

export function Setup({
  state,
  cursor,
  draftPath = '',
  inspection = null,
  error = null,
  repos = [],
  repoCursor = 0,
  exitLabel = 'quit',
}: SetupProps): React.ReactElement {
  const missing = missingRuntimesFor(state.selected, state.runtimes)
  const step = SETUP_ORDER.indexOf(state.state) + 1
  const onRepo = state.state === 'credentials-and-repo'
  const { columns, rows } = useWindowSize()
  const width = setupWidth(columns)
  const body = setupBodyRows(rows, (missing.length > 0 ? 1 : 0) + (error !== null ? 1 : 0))

  return (
    // `single` and not `round`: the wizard is the one frame in the interface
    // `Panel` does not draw, and its `╭╮` corners were the only ones that did
    // not match the `┌┐` of every panel the session opens onto — visible the
    // moment §14.2 renders this same component as a screen inside that session.
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={ACCENT}
      paddingX={1}
    >
      <Box>
        <Text bold>SkillGantry setup — {STEPS[state.state].title}</Text>
        <Text dimColor>
          {'  '}step {step} of {SETUP_ORDER.length}
        </Text>
      </Box>
      <StepRail current={state.state} />
      <Box marginTop={1} flexDirection="column">
        {state.state === 'probe-runtimes' &&
          state.runtimes.map((runtime) => (
            <Text key={runtime.runtime}>
              <Text color={runtime.present ? STATUS.ok : STATUS.warn}>
                {runtime.present ? '●' : '×'}
              </Text>{' '}
              {runtime.runtime}{' '}
              {runtime.present ? (
                <Text color={STATUS.ok}>{runtime.version}</Text>
              ) : (
                // R3.7: shown, never run.
                <Text color={STATUS.warn}>missing — install with: {runtime.installCommand}</Text>
              )}
            </Text>
          ))}

        {state.state === 'select-tools' &&
          (() => {
            // The hint row is spent out of the same allocation as the list, per
            // §14.1's first rule, and so is the overflow footnote.
            const window = listWindow(CATALOGUE.length, cursor, body - 1)
            return (
              <Box flexDirection="column">
                <Text dimColor>1 minimal · 2 recommended · 3 everything · space toggles</Text>
                {CATALOGUE.slice(window.from, window.to).map((spec, offset) => {
                  const index = window.from + offset
                  return (
                    <Text key={spec.id}>
                      {index === cursor ? '▸' : ' '}
                      {state.selected.includes(spec.id) ? '*' : ' '} {spec.displayName}{' '}
                      <Text dimColor>({spec.stage ?? 'release gate'})</Text>
                    </Text>
                  )
                })}
                {window.hidden > 0 && (
                  <Text dimColor>
                    {'  '}
                    {window.hidden} more · j/k
                  </Text>
                )}
              </Box>
            )
          })()}

        {state.state === 'install-and-verify' &&
          (() => {
            const window = listWindow(state.selected.length, state.selected.length - 1, body)
            return (
              <Box flexDirection="column">
                {state.selected.slice(window.from, window.to).map((id) => {
                  const outcome = state.toolConfig[id]
                  const config = outcome ? configField(outcome) : null
                  return (
                    <Text key={id}>
                      {MARK[state.installed[id] ?? 'pending']} {id}
                      {state.installed[id] === 'failed' ? (
                        <Text color={STATUS.bad}> failed — {state.errors[id]}</Text>
                      ) : null}
                      {config ? <Text color={config.tone}> {config.text}</Text> : null}
                    </Text>
                  )
                })}
                {window.hidden > 0 && (
                  <Text dimColor>
                    {'  '}
                    {window.hidden} more
                  </Text>
                )}
              </Box>
            )
          })()}

        {onRepo && (
          <RepoStep
            state={state}
            draftPath={draftPath}
            inspection={inspection}
            repos={repos}
            repoCursor={repoCursor}
            body={body}
          />
        )}

        {state.state === 'done' && (
          <Text color={STATUS.ok}>
            Toolchain verified.{' '}
            {state.repoPath === null
              ? 'No repo registered — add one from Settings.'
              : // The resolved path, not the shorthand that was typed: it is
                // what actually went into the config.
                `Registered ${inspection?.resolved ?? state.repoPath}.`}
          </Text>
        )}
      </Box>

      {missing.length > 0 && (
        <Text color={STATUS.warn}>
          {missing.length} runtime{missing.length === 1 ? '' : 's'} missing for this selection —
          install them and press p
        </Text>
      )}
      {error !== null && <Text color={STATUS.bad}>{error}</Text>}
      <Box marginTop={1}>
        {/* Truncated, not wrapped, for §14.1's reason: a footer that wraps to
            two rows makes the frame one row taller than the terminal, which a
            longer `exitLabel` did at 50×14. */}
        <Text dimColor wrap="truncate">
          {truncate(
            state.state === 'done'
              ? `q ${exitLabel}`
              : onRepo
                ? repoHint(repos.length, repoCursor)
                : `enter advance · b back · p re-probe · q ${exitLabel}`,
            width - 2,
          )}
        </Text>
      </Box>
    </Box>
  )
}
