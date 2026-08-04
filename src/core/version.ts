import { readFileSync } from 'node:fs'

/**
 * The package's own version, read from `package.json` rather than restated as a
 * literal. `program.version('0.1.0')` had already drifted two minor versions
 * behind the manifest, so `skillgantry --version` reported a release that was
 * never packed. One source, and R13.5's check over the packed artefact is a
 * check of the real number.
 *
 * `../../package.json` resolves to the package root from both `dist/core/` and
 * `src/core/`, since `rootDir` and `outDir` sit at the same depth.
 */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
