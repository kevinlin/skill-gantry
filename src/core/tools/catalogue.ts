import type { InstallSpec } from '../adapters/types.js'
import type { Stage } from '../types.js'

/** The runtime a tool's install driver needs on the host. */
export type Runtime = 'uv' | 'npm' | 'none'

/**
 * A tool published as a bundle of agent skills rather than an executable. It is
 * declared here and not in `adapters/types.ts` because an adapter manifest can
 * never legitimately carry it — the tool it would describe has no executable to
 * invoke — and widening the shared union would make that nonsense typecheck,
 * weakening the §5.1a test that asserts catalogue and manifest agree.
 */
export interface GitSkillSpec {
  kind: 'git-skill'
  /** `owner/name`, cloned over https. */
  repo: string
  /** A commit sha — upstream publishes no tags. */
  pin: string
  /** Directory names under the repo's `skills/`, each symlinked individually. */
  skills: readonly string[]
  /** Repo-relative path to the pip requirements file. */
  requirements: string
}

export interface ToolSpec {
  id: string
  displayName: string
  /** null for the release installer: it is invoked by a stage, selected by none. */
  stage: Stage | null
  runtime: Runtime
  install: InstallSpec | GitSkillSpec
  versionArgv: readonly string[]
}

/** R3.5a: release cannot run its installability gate without this one. */
export const RELEASE_TOOL_ID = 'skills'

/** R3.5 as amended: optimise's member, published as a skill bundle, not a CLI. */
export const SKILLHONE_TOOL_ID = 'skillhone'

/**
 * Every entry was probed against its real index before being written here, and
 * every pin is a version that index actually carries — M1 shipped once with a
 * SkillSpector pin upstream never published. Three of D7's eight tools are
 * absent: agentskills and SkillOpt because no public source publishes them in
 * installable form, with the probe output behind each omission recorded in
 * docs/specs/plan-m3.md, and promptfoo because it drives off a per-skill config
 * no skill carries — docs/specs/decision-log.md §10. SkillHone was a fourth
 * until M9: that probe asked whether it is published as a *CLI*, and it is not,
 * but it is published as a bundle of agent skills — decision-log.md §13.
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
  {
    id: SKILLHONE_TOOL_ID,
    displayName: 'SkillHone (Tencent)',
    // The venv is built with the managed uv. `git` is not a declared runtime:
    // §12's sandbox strategies already assume it unconditionally, so a probe
    // state that could report it missing would be the only one in the system.
    runtime: 'uv',
    stage: null,
    install: {
      kind: 'git-skill',
      repo: 'Tencent/SkillHone',
      pin: '7d565839fb4dc74f9c77f09ace660e1c0484e048',
      skills: [
        'skillhone',
        'skillhone-optimization',
        'skillhone-evaluation',
        'skillhone-prd',
        'skillhone-synthesis',
        'forgejo',
      ],
      requirements: 'skills/skillhone/assets/requirements.txt',
    },
    // Nothing in a skill bundle answers a version argv, which is what forces
    // `git-skill` to verify by three facts instead — design §5.2.
    versionArgv: [],
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
 * Optimise's member is SkillHone, which is published as a skill bundle rather
 * than a CLI — R3.5 as amended. Minimal omits it: a clone plus a litellm[proxy]
 * venv is not what "the two already present" means.
 * Evaluate has one candidate rather than two — promptfoo needs a per-skill
 * promptfooconfig.yaml that no skill in either reference repo carries, so it
 * would install and then error on every real input. Decision-log section 10.
 */
export const PRESETS: Readonly<Record<PresetName, readonly string[]>> = {
  minimal: ['skill-up', 'skillspector', RELEASE_TOOL_ID],
  recommended: ['skill-lint', 'skill-up', 'skillspector', SKILLHONE_TOOL_ID, RELEASE_TOOL_ID],
  everything: catalogueIds(),
}

export function expandPreset(name: PresetName): readonly ToolSpec[] {
  return PRESETS[name].flatMap((id) => {
    const spec = catalogueEntry(id)
    return spec ? [spec] : []
  })
}
