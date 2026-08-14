import type { ManifestLookup } from '../../src/core/stages/prompt-parts.js'

/**
 * R6.14's fan-out: one tool declaring a baseline, every other tool declaring
 * none. Shared rather than declared per suite because both prompt suites assert
 * this template resolves to the same absolute path — two copies means changing
 * it passes in one file and fails in the other.
 */
export const baselineForSkillspector: ManifestLookup = (id) =>
  id === 'skillspector'
    ? {
        manifest: {
          artefacts: ['findings.sarif'],
          baseline: { path: '{skillDir}/.skillspector-baseline.yaml' },
        },
      }
    : { manifest: { artefacts: ['report.json'] } }
