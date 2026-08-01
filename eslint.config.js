import tseslint from 'typescript-eslint'

const noCrossImport = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
})

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      ...noCrossImport([
        { group: ['**/tui/**', '**/cli/**'], message: 'core must not import tui or cli' },
      ]),
      'no-console': 'error',
      'no-process-exit': 'error',
    },
  },
  {
    files: ['src/tui/**/*.ts', 'src/tui/**/*.tsx'],
    rules: noCrossImport([{ group: ['**/cli/**'], message: 'tui must not import cli' }]),
  },
  {
    files: ['src/core/adapters/**/*.ts'],
    rules: noCrossImport([
      { group: ['**/tui/**', '**/cli/**'], message: 'core must not import tui or cli' },
      {
        group: ['node:fs', 'node:fs/*', 'node:child_process', 'node:https', 'node:net'],
        message: 'adapters are pure: they receive artefact bytes, they do not read them',
      },
    ]),
  },
)
