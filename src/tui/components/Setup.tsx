import { Box, Text, useWindowSize } from 'ink'
import { setupWidth, truncate } from '../layout.js'
import {
  CATALOGUE,
  SETUP_ORDER,
  missingRuntimesFor,
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

export interface SetupProps {
  state: SetupState
  cursor: number
  /** What the user has typed but not yet submitted. */
  draftPath?: string
  inspection?: RepoInspection | null
  error?: string | null
  /**
   * What `q` does for this caller. `skillgantry setup` ends the process; the
   * same wizard inside a session returns to Settings, and a footer that
   * promised "quit" there described a key that does something else.
   */
  exitLabel?: string
}

/** Never colour alone: every state also differs in glyph and in weight. */
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
              color={done ? 'green' : here ? 'cyan' : 'gray'}
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

function RepoStep({
  state,
  draftPath,
  inspection,
}: {
  state: SetupState
  draftPath: string
  inspection: RepoInspection | null
}): React.ReactElement {
  const typed = draftPath.length > 0
  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>credentials </Text>
        {state.credentials?.present ? (
          <Text color="green">~/.skillgantry/.env found</Text>
        ) : (
          <Text color="yellow">no .env yet</Text>
        )}
      </Text>
      {(state.credentials?.warnings ?? []).map((warning) => (
        <Text key={warning} color="yellow">
          {'  '}
          {warning}
        </Text>
      ))}

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

      {typed && inspection && <Verdict inspection={inspection} />}
    </Box>
  )
}

function Verdict({ inspection }: { inspection: RepoInspection }): React.ReactElement {
  const { resolved, isDirectory, alreadyRegistered, skillCount } = inspection
  return (
    <Box flexDirection="column">
      <Text dimColor>{'          → '}{resolved}</Text>
      <Text>
        {'          '}
        {!isDirectory ? (
          <Text color="red">error: no such directory</Text>
        ) : alreadyRegistered ? (
          <Text color="red">error: already registered</Text>
        ) : skillCount === 0 ? (
          <Text color="yellow">warning: no skills found here — enter registers it anyway</Text>
        ) : (
          <Text color="green">
            {skillCount} skill{skillCount === 1 ? '' : 's'} found
          </Text>
        )}
      </Text>
    </Box>
  )
}

export function Setup({
  state,
  cursor,
  draftPath = '',
  inspection = null,
  error = null,
  exitLabel = 'quit',
}: SetupProps): React.ReactElement {
  const missing = missingRuntimesFor(state.selected, state.runtimes)
  const step = SETUP_ORDER.indexOf(state.state) + 1
  const onRepo = state.state === 'credentials-and-repo'
  const { columns } = useWindowSize()
  const width = setupWidth(columns)

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor="cyan"
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
              <Text color={runtime.present ? 'green' : 'yellow'}>
                {runtime.present ? '●' : '×'}
              </Text>{' '}
              {runtime.runtime}{' '}
              {runtime.present ? (
                <Text color="green">{runtime.version}</Text>
              ) : (
                // R3.7: shown, never run.
                <Text color="yellow">missing — install with: {runtime.installCommand}</Text>
              )}
            </Text>
          ))}

        {state.state === 'select-tools' && (
          <Box flexDirection="column">
            <Text dimColor>1 minimal · 2 recommended · 3 everything · space toggles</Text>
            {CATALOGUE.map((spec, index) => (
              <Text key={spec.id}>
                {index === cursor ? '›' : ' '}
                {state.selected.includes(spec.id) ? '*' : ' '} {spec.displayName}{' '}
                <Text dimColor>({spec.stage ?? 'release gate'})</Text>
              </Text>
            ))}
          </Box>
        )}

        {state.state === 'install-and-verify' &&
          state.selected.map((id) => (
            <Text key={id}>
              {MARK[state.installed[id] ?? 'pending']} {id}
              {state.installed[id] === 'failed' ? (
                <Text color="red"> failed — {state.errors[id]}</Text>
              ) : null}
            </Text>
          ))}

        {onRepo && <RepoStep state={state} draftPath={draftPath} inspection={inspection} />}

        {state.state === 'done' && (
          <Text color="green">
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
        <Text color="yellow">
          {missing.length} runtime{missing.length === 1 ? '' : 's'} missing for this selection —
          install them and press p
        </Text>
      )}
      {error !== null && <Text color="red">{error}</Text>}
      <Box marginTop={1}>
        {/* Truncated, not wrapped, for §14.1's reason: a footer that wraps to
            two rows makes the frame one row taller than the terminal, which a
            longer `exitLabel` did at 50×14. */}
        <Text dimColor wrap="truncate">
          {truncate(
            state.state === 'done'
              ? `q ${exitLabel}`
              : onRepo
                ? 'enter register · esc back · ctrl-d finish without a repo'
                : `enter advance · b back · p re-probe · q ${exitLabel}`,
            width - 2,
          )}
        </Text>
      </Box>
    </Box>
  )
}
