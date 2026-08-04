# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Render target is a terminal, not a browser: an Ink (React) TUI shipped as the `skillgantry` CLI. Recorded as `web` because the schema's other values name native mobile design languages, which do not apply. Flexbox layout applies; every browser affordance (hover, scrollbars, pointer, arbitrary colour, sub-cell geometry) does not.

## Users

Primary user is a **team skill maintainer**: someone maintaining a shared agent-skills repo whose output other people consume. Gates, releases and issue triage matter to them because a bad release reaches teammates, not just their own machine.

They work locally, at a terminal, in a repo they already have checked out. They are not the skill's only author and are not the tool's author.

Secondary audiences are not confirmed. Skill *authoring* is explicitly out of scope (R1.2), so the author-only persona is not a user of this product.

## Product Purpose

SkillGantry orchestrates the maintainer half of the SkillOps lifecycle: `validate` → `evaluate` → `security` → `optimise` → `release`, plus `retire`.

It discovers skills in registered repos, installs and spawns external CLI tools against them, normalises their output into findings, writes evidence to each skill's sidecar workspace, and records runs and issues in a local SQLite ledger.

Success is that a maintainer can answer "is this skill releasable, and on what evidence?" without running five tools by hand and reading five output formats — and that the release itself is gated on a verifiable installability check rather than bookkeeping.

## Positioning

The lifecycle stages exist as separate public CLIs; nothing else runs them as one gated pipeline over a *skill directory* and keeps the result.

Three things a neighbouring tool could not truthfully copy without building them:

- **Evidence is durable and per-skill.** Every run writes artefacts to the skill's sidecar workspace and a row to a local ledger, so the answer survives the session.
- **Findings reconcile into issues.** Tool output is normalised across tools, deduplicated by finding identity, and an issue closes only when every detector that could see it agrees it is gone.
- **Release is a native gate, not a wrapper.** Dual version bump, changelog, evidence bundle, archive, then a real install of that archive via vercel `skills` to confirm it resolves.

## Operating Context

- Local machine, terminal, Node >= 24. Installed as a CLI (`skillgantry`), also runnable headless per subcommand.
- Repos are registered by filesystem path. They may or may not be git; that choice selects the mutation isolation strategy.
- Skills are direct child directories containing `SKILL.md`; sidecar workspaces are siblings named `<skill>-workspace/`.
- The tools SkillGantry drives are installed into a directory it owns, never the user's global environment.
- Two paths write to the user's own repo — `release` and `retire`. Everything else is read-plus-sidecar.
- Runs can be long (a real eval iteration ran 1m54s for 4 cases), queued in a batch, and cancelled mid-flight. The user is watching a terminal while that happens.

## Capabilities and Constraints

Confirmed functionality: repo registration and discovery; tool install/lock/verify plus `doctor` drift reporting; a first-run setup wizard; a bounded worker pool draining a queue of skill × stage jobs; the five lifecycle stages plus retirement; statistics over its own runs; a ledger of runs, findings and issues.

Binding constraints:

- **The specs are the contract.** `docs/specs/requirements.md` (numbered `R*`), then `docs/specs/design.md`, then the code. Design work that proves a spec wrong amends the spec in the same branch rather than diverging from it. Confirmed by the user as the durable constraint future work must preserve.
- **§14 owns the screens**; §14.1 owns the row budget and render discipline; §15 owns the CLI surface and exit codes. Read the owning section before changing a contract.
- **No token or cost metrics** (R1.5). The metric key type is a closed union with no such key; enforcement is by construction, not by policy.
- **No production telemetry, no registry, no server component, no skill authoring, no consumer lifecycle** (R1.2). "Observe" is satisfied only by statistics over runs SkillGantry itself executed (R1.3).
- **`SKILL.md` frontmatter is the authority** for a skill's lifecycle state; ledger lifecycle columns are a derived cache and a divergence is reported as drift, not an error (R1.6).
- **Import direction is `cli → tui → core`**, enforced by lint. The TUI may touch fs, may not spawn or open the ledger; every ledger read reaches it through one injected port.

Terminology used throughout, in the user's language and the code's: skill, repo, sidecar workspace, candidate manifest, skill digest, stage, tool outcome, stage outcome, finding, issue, reconciliation, run, ledger, lockfile, drift, gate, release candidate, retirement. British spelling in identifiers that appear in the specs (`optimise`, `artefact`, `normalise`).

## Brand Commitments

Name: SkillGantry. Binary: `skillgantry`. No other identity constraint has been established.

## Evidence on Hand

- `docs/specs/` — requirements (`R*`), design, decision log (`D*`), per-milestone plans, two historical design reviews. `docs/specs/index.md` is the only catalogue.
- `docs/research/` — the source documents behind the decision log.
- Adapter golden fixtures captured from pinned tool versions, regenerated by `scripts/capture-fixtures.sh`.
- Real run evidence exists (e.g. run `019fc2e4`, which prompted requirements revision 6).

No customers, testimonials, benchmarks, pricing, adoption numbers or press exist. Future work must not fabricate any.

## Product Principles

1. **Evidence over assertion.** Every verdict points at artefacts on disk and a ledger row. A screen that states an outcome without a path to its evidence is incomplete.
2. **The user's repo is sacred.** Only `release` and `retire` write to it, only after a displayed diff and explicit authorisation, and always with a path back from every failure.
3. **A closed set beats a permissive one.** Outcomes, metric keys, rule classes and error kinds are enumerated and total. Where a category could drift, it is made impossible rather than validated.
4. **The maintainer is watching a long-running process.** Queue state, progress, cancellability and partial evidence on failure are first-class, not an afterthought.
5. **Specs first, code second.** When implementation proves a spec wrong, the spec is amended in the same branch.

## Accessibility & Inclusion

No product-specific standard has been established. Two facts constrain the terminal render target regardless: colour support and width vary by emulator, and the design's row budget exists because the viewport is not scrollable the way a page is. Whether colour-independent state encoding becomes a binding requirement is undecided.
