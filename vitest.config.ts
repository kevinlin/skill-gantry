import { defineConfig } from 'vitest/config'

/**
 * The install driver is the one suite that touches the network and a real
 * package index, so the default run excludes it and `test:integration` opts in.
 */
const INTEGRATION = ['tests/core/install.test.ts']

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(process.env.SG_INTEGRATION ? [] : INTEGRATION),
    ],
    testTimeout: 30_000,
  },
})
