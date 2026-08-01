import { defineConfig } from 'vitest/config'

/**
 * Two opt-in suites keep the default run offline and fast: the install driver
 * reaches a real package index, and the acceptance suite drives the whole CLI.
 */
const INTEGRATION = ['tests/core/install.test.ts']
const ACCEPTANCE = ['tests/acceptance/**']

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(process.env.SG_INTEGRATION ? [] : INTEGRATION),
      ...(process.env.SG_ACCEPTANCE ? [] : ACCEPTANCE),
    ],
    testTimeout: 30_000,
  },
})
