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
  /** A commit sha where upstream publishes no tags, otherwise a release tag. */
  pin: string
  /** Directory names under the repo's `skills/`, each symlinked individually. */
  skills: readonly string[]
  /**
   * Repo-relative path to the pip requirements file, absent for a bundle with
   * no runtime dependencies at all. That the field was mandatory was a fact
   * about SkillHone rather than about the kind: skill-upper is SKILL.md,
   * templates and references, and building an empty venv to satisfy the field
   * would install a runtime the tool never uses — design §5.1a.
   */
  requirements?: string
}

export interface ToolSpec {
  id: string
  displayName: string
  /**
   * The stage whose `stageTools` may select this tool, `null` when none may:
   * the release installer, which release invokes directly, and a `git-skill`
   * bundle, which has no adapter to parse it.
   */
  stage: Stage | null
  /**
   * The lifecycle stage the tool serves — every catalogue entry serves exactly
   * one, including the three `stage` cannot name. Separate from `stage` because
   * that field answers "may a run select it", not "what is it for": SkillHone
   * serves optimise and must still never reach `stageTools`. Reading `stage`
   * for a label is what made the wizard call SkillHone a release gate.
   */
  serves: Stage
  runtime: Runtime
  install: InstallSpec | GitSkillSpec
  versionArgv: readonly string[]
}

/** R3.5a: release cannot run its installability gate without this one. */
export const RELEASE_TOOL_ID = 'skills'

/** R3.5 as amended: optimise's member, published as a skill bundle, not a CLI. */
export const SKILLHONE_TOOL_ID = 'skillhone'

/**
 * R3.11: skill-up's authoring companion, which owns the eval templates and the
 * judge guidance R6.13's prompt hands over. Selected by no stage and by no
 * preset — R3.8 as amended makes it follow skill-up into the install set,
 * because a guide for a binary the machine does not have is not a choice.
 */
export const SKILL_UPPER_TOOL_ID = 'skill-upper'

/** R3.11: the tool whose selection drags skill-upper in with it. */
export const SKILL_UP_TOOL_ID = 'skill-up'

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
    serves: 'validate',
    runtime: 'npm',
    install: { kind: 'npm-prefix', spec: 'skill-lint', pin: '0.2.0', binName: 'skill-lint' },
    versionArgv: ['--version'],
  },
  {
    id: 'skill-up',
    displayName: 'skill-up (Alibaba)',
    stage: 'evaluate',
    serves: 'evaluate',
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
    serves: 'security',
    runtime: 'uv',
    install: { kind: 'uv-tool', spec: 'skill-scanner', pin: '0.3.3', binName: 'skill-scanner' },
    versionArgv: ['--version'],
  },
  {
    id: 'skillspector',
    displayName: 'SkillSpector (NVIDIA)',
    stage: 'security',
    serves: 'security',
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
    serves: 'release',
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
    serves: 'optimise',
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
  {
    id: SKILL_UPPER_TOOL_ID,
    displayName: 'skill-upper (Alibaba)',
    // No requirements file, so no venv is built and `uv` is never invoked:
    // the bundle is SKILL.md, two .tmpl assets, references/ and its own evals/.
    runtime: 'none',
    stage: null,
    // It authors the suites skill-up runs, so it serves the same stage its
    // companion does — which is also why R3.8 makes it follow that selection.
    serves: 'evaluate',
    install: {
      kind: 'git-skill',
      repo: 'alibaba/skill-up',
      // The release tag, not a commit sha as SkillHone's is: one pin for both
      // halves of one upstream project cannot drift against itself, and
      // guidance documenting flags the locked binary does not have is worse
      // than guidance that lags a skill fix by a release. Probed at this tag.
      pin: 'v0.7.0',
      skills: [SKILL_UPPER_TOOL_ID],
    },
    versionArgv: [],
  },
]

/**
 * What the wizard offers and what `everything` expands to. skill-upper is
 * absent: R3.8 as amended makes it follow skill-up into the install set rather
 * than being chosen, so a row for it would let a user install a guide for a
 * binary they do not have. `CATALOGUE` stays the install, verify and lock
 * authority — this is the selection view of it.
 */
export const SELECTABLE_CATALOGUE: readonly ToolSpec[] = CATALOGUE.filter(
  (spec) => spec.id !== SKILL_UPPER_TOOL_ID,
)

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
  minimal: [SKILL_UP_TOOL_ID, 'skillspector', RELEASE_TOOL_ID],
  recommended: [
    'skill-lint',
    SKILL_UP_TOOL_ID,
    'skillspector',
    SKILLHONE_TOOL_ID,
    RELEASE_TOOL_ID,
  ],
  everything: SELECTABLE_CATALOGUE.map((spec) => spec.id),
}

/**
 * R3.8 as amended: skill-upper is not chosen, it follows skill-up. One rule
 * over the selection rather than an entry in three presets, so per-stage
 * choice picks it up too — a fourth listing would be a fourth place to forget.
 */
export function expandSelection(selected: readonly string[]): readonly string[] {
  return selected.includes(SKILL_UP_TOOL_ID) && !selected.includes(SKILL_UPPER_TOOL_ID)
    ? [...selected, SKILL_UPPER_TOOL_ID]
    : selected
}

export function expandPreset(name: PresetName): readonly ToolSpec[] {
  return PRESETS[name].flatMap((id) => {
    const spec = catalogueEntry(id)
    return spec ? [spec] : []
  })
}
