import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const run = promisify(execFile)

describe('import boundary', () => {
  it('rejects an import from core into cli', async () => {
    const offender = join(process.cwd(), 'src/core/__boundary_probe__.ts')
    await writeFile(offender, `import '../cli/index.js'\nexport const x = 1\n`)
    try {
      await run('pnpm', ['exec', 'eslint', offender], { cwd: process.cwd() })
      throw new Error('eslint should have failed')
    } catch (err) {
      expect(String((err as { stdout?: string }).stdout)).toContain('no-restricted-imports')
    } finally {
      await rm(offender, { force: true })
    }
    // Each case spawns a full eslint process, which is slow enough under a
    // loaded parallel run to reach the default 30s ceiling.
  }, 60_000)

  it('rejects node:fs inside adapters', async () => {
    const offender = join(process.cwd(), 'src/core/adapters/__boundary_probe__.ts')
    await writeFile(offender, `import 'node:fs'\nexport const x = 1\n`)
    try {
      await run('pnpm', ['exec', 'eslint', offender], { cwd: process.cwd() })
      throw new Error('eslint should have failed')
    } catch (err) {
      expect(String((err as { stdout?: string }).stdout)).toContain('no-restricted-imports')
    } finally {
      await rm(offender, { force: true })
    }
    // Each case spawns a full eslint process, which is slow enough under a
    // loaded parallel run to reach the default 30s ceiling.
  }, 60_000)
})
