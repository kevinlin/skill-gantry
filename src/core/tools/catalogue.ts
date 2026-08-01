import type { InstallSpec } from '../adapters/types.js'
import type { Stage } from '../types.js'

/** The runtime a tool's install driver needs on the host. */
export type Runtime = 'uv' | 'npm' | 'none'

export interface ToolSpec {
  id: string
  displayName: string
  /** null for the release installer: it is invoked by a stage, selected by none. */
  stage: Stage | null
  runtime: Runtime
  install: InstallSpec
  versionArgv: readonly string[]
}

/** R3.5a: release cannot run its installability gate without this one. */
export const RELEASE_TOOL_ID = 'skills'

/**
 * Every entry was probed against its real index before being written here, and
 * every pin is a version that index actually carries — M1 shipped once with a
 * SkillSpector pin upstream never published. Two of D7's eight tools are absent
 * because no public source publishes them in installable form; the probe output
 * behind each omission is recorded in docs/specs/plan-m3.md.
 */
export const CATALOGUE: readonly ToolSpec[] = [
  {
    id: 'skill-lint',
    displayName: 'skill-lint',
    stage: 'validate',
    runtime: 'npm',
    install: { kind: 'npm-prefix', spec: 'skill-lint', pin: '0.2.0', binName: 'skill-lint' },
    versionArgv: ['--version'],
  },
  {
    id: 'skill-up',
    displayName: 'skill-up (Alibaba)',
    stage: 'evaluate',
    runtime: 'none',
    install: {
      kind: 'gh-release',
      repo: 'alibaba/skill-up',
      pin: 'v0.7.0',
      assetPattern: 'skill-up_0\\.7\\.0_{os}_{arch}\\.tar\\.gz',
      binName: 'skill-up',
      integrity: { kind: 'sha256-asset', assetPattern: 'skill-up_0\\.7\\.0_checksums\\.txt' },
    },
    versionArgv: ['--version'],
  },
  {
    id: 'promptfoo',
    displayName: 'promptfoo',
    stage: 'evaluate',
    runtime: 'npm',
    install: { kind: 'npm-prefix', spec: 'promptfoo', pin: '0.121.20', binName: 'promptfoo' },
    versionArgv: ['--version'],
  },
  {
    id: 'skill-scanner',
    displayName: 'skill-scanner',
    stage: 'security',
    runtime: 'uv',
    install: { kind: 'uv-tool', spec: 'skill-scanner', pin: '0.3.3', binName: 'skill-scanner' },
    versionArgv: ['--version'],
  },
  {
    id: 'skillspector',
    displayName: 'SkillSpector (NVIDIA)',
    stage: 'security',
    runtime: 'uv',
    install: {
      kind: 'uv-tool',
      spec: 'git+https://github.com/NVIDIA/skillspector.git',
      pin: 'v2.5.1',
      binName: 'skillspector',
    },
    versionArgv: ['--version'],
  },
  {
    id: RELEASE_TOOL_ID,
    displayName: 'skills (vercel-labs)',
    stage: null,
    runtime: 'npm',
    install: { kind: 'npm-prefix', spec: 'skills', pin: '1.5.21', binName: 'skills' },
    versionArgv: ['--version'],
  },
]

const BY_ID = new Map(CATALOGUE.map((spec) => [spec.id, spec]))

export function catalogueEntry(id: string): ToolSpec | undefined {
  return BY_ID.get(id)
}

export function catalogueIds(): readonly string[] {
  return CATALOGUE.map((spec) => spec.id)
}

export function toolsForStage(stage: Stage): readonly ToolSpec[] {
  return CATALOGUE.filter((spec) => spec.stage === stage)
}

export type PresetName = 'minimal' | 'recommended' | 'everything'

/**
 * Minimal is the two tools already on the reference machine; Recommended is one
 * per stage; Everything is the catalogue. All three carry the release installer,
 * because a preset that omits it produces a toolchain release cannot gate.
 * Optimise has no member: both of D7's optimise candidates are uninstallable.
 */
export const PRESETS: Readonly<Record<PresetName, readonly string[]>> = {
  minimal: ['skill-up', 'skillspector', RELEASE_TOOL_ID],
  recommended: ['skill-lint', 'skill-up', 'skillspector', RELEASE_TOOL_ID],
  everything: catalogueIds(),
}

export function expandPreset(name: PresetName): readonly ToolSpec[] {
  return PRESETS[name].flatMap((id) => {
    const spec = catalogueEntry(id)
    return spec ? [spec] : []
  })
}
