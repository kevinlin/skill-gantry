import { Box, Text } from 'ink'
import { CATALOGUE, missingRuntimesFor, type SetupState } from '../../core/index.js'

const TITLE: Record<SetupState['state'], string> = {
  'probe-runtimes': 'Runtimes',
  'select-tools': 'Select tools',
  'install-and-verify': 'Install and verify',
  'credentials-and-repo': 'Credentials and repo',
  done: 'Done',
}

const MARK: Record<string, string> = { pending: '·', installing: '◐', ok: '●', failed: '×' }

export interface SetupProps {
  state: SetupState
  cursor: number
}

export function Setup({ state, cursor }: SetupProps): React.ReactElement {
  const missing = missingRuntimesFor(state.selected, state.runtimes)
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold>
        SkillGantry setup — {TITLE[state.state]} ({state.state})
      </Text>

      {state.state === 'probe-runtimes' &&
        state.runtimes.map((runtime) => (
          <Text key={runtime.runtime}>
            {runtime.present ? '●' : '×'} {runtime.runtime}{' '}
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

      {state.state === 'credentials-and-repo' && (
        <Box flexDirection="column">
          <Text>
            credentials: {state.credentials?.present ? '~/.skillgantry/.env found' : 'no .env yet'}
          </Text>
          {(state.credentials?.warnings ?? []).map((warning) => (
            <Text key={warning} color="yellow">
              {warning}
            </Text>
          ))}
          <Text>repo: {state.repoPath ?? 'type a path, then enter'}</Text>
          <Text dimColor>while typing a path, esc goes back — letters are text, not commands</Text>
        </Box>
      )}

      {state.state === 'done' && <Text color="green">Toolchain verified. Press q to leave.</Text>}

      {missing.length > 0 && (
        <Text color="yellow">
          {missing.length} runtime(s) missing for this selection — install them and press p
        </Text>
      )}
      <Text dimColor>enter advance · b back · p re-probe · q quit</Text>
    </Box>
  )
}
