# Changelog

One section per released version, newest first. The client reads this file from the release's own
asset rather than from a branch (R13.9), so a section is immutable once its release is published.

Backfilled from a first-parent walk of `package.json`'s version — `scripts/changelog-from-history.sh`.

## 0.5.1 — 2026-08-10
- fix(setup): label each tool with the stage it serves

## 0.5.0 — 2026-08-10
- feat(tui): two-level repo and skill navigation in the list column

## 0.4.3 — 2026-08-10

## 0.4.2 — 2026-08-10
- feat(setup): show registered repos and replace one in place
- feat(tui): open the eval bootstrap surface when evaluate has no suite
- feat(evals): build the eval bootstrap prompt and print it headlessly
- feat(tools): catalogue skill-upper as a git-skill bundle with no dependencies

## 0.4.1 — 2026-08-10
- ui: colour for state; the terminal's own for surface
- feat(setup): compose the SkillHone settings file at install time

## 0.4.0 — 2026-08-10
- feat(tui): count the running stage and orient on empty surfaces
- feat(tui): open an optimise surface from the rail mark
- feat(cli): add skillgantry optimise and planOptimise
- feat(stages): build the coding-agent optimisation prompt
- feat(tools): dispatch and verify git-skill installs
- feat(tools): add the git-skill install driver
- feat(tools): catalogue SkillHone as a git-skill bundle
- fix(core): stop a cancelled gate superseding the pass it never contradicted
- fix(tui): stop a marked release swallowing the stage that would unblock it

## 0.3.3 — 2026-08-09
- fix(core): reproduce the candidate manifest in the git sandbox
- feat(tui): collect the release target before enqueuing the job
- fix(specs): correct a spec-test path assertion

## 0.3.2 — 2026-08-09
- feat(tui): advertise the dashboard key on every overview tier
- feat(tui): advertise the detail view and the four keys the help screen omitted
- feat(tui): open the selected finding or issue at full length
- fix(tui): give the issues tab a cursor its own keys move
- feat(tui): focus the output pane from the key that selects its view
- feat(tui): move the rail with the horizontal arrows

## 0.3.1 — 2026-08-09
- feat(tui): accept a finding with s, and re-run the gates it invalidated
- feat(tui): resolve the gate chain a suppression invalidates
- feat(tui): add the suppression confirmation pane
- feat(cli): add skillgantry suppress
- feat(suppress): resolve an issue or finding to the tools that can accept it
- feat(suppress): stage, diff, recheck and atomically rename a baseline write
- feat(candidate): exclude the suppression write temp file from the digest
- feat(suppress): append an accepted finding to a baseline document
- feat(suppress): compose a baseline entry from a finding
- feat(adapters): declare a tool's suppression file on its manifest
- ui: polish pass

## 0.3.0 — 2026-08-09
- ui: highlight a selected row with padded reverse video
- ui: show stage pass rates beside the skill list in height-driven tiers
- ui: copy the fix prompt of the stage that found the selected finding
- ui: open a finding's artefact directory through the host
- ui: give the findings pane a cursor and inline evidence
- ui: attribute every finding to its stage, tool and artefact directory
- ui: triage issues from the Work screen over one shared row builder
- ui: scope every movement key to one of three focus zones
- ui: draw a titled panel's heading in its top border
- ui: take the D23 palette for state and leave surfaces to the terminal
- ui: add the design system
- feat: respect a tool's own suppression baseline
- feat: add `y copy` to the key hints

## 0.2.2 — 2026-08-05
- feat: rehydrate the last recorded run on the Work screen
- feat: replay a rehydrated run's tool output in the Log pane

## 0.2.1 — 2026-08-05
- ui: delight pass
- feat: generate a coding-agent fix prompt for a stage that found something
- feat: name the running version in the status bar
- ui: make the output pane readable

## 0.2.0 — 2026-08-05
- ui: polish pass
- ui: initial visual design
- fix: keep the wizard's repo submit to one round trip (R3.6)
- feat: gate settings edits behind a confirmed change set (R11.7, R11.8)
- feat: run the setup states as a TUI screen that stages its result (R11.8)
- feat: stage settings edits in the store without writing config (R11.8)
- feat: report each setting's holding file and origin on the settings screen (R11.7)
- feat: add pure config transforms and a semantic change list (R11.8)
- fix: keep every screen inside its row budget and document the new keys
- feat: show the doctor report and the resolved settings as screens
- feat: triage issues across repos from an Issues screen
- feat: render cross-repo statistics on a Dashboard screen
- feat: make every top-level screen reachable through a command palette
- feat: give the terminal interface one port for ledger and doctor reads
- feat: list issues across repos and apply the user state transitions
- feat: answer R8.9's statistics from the ledger, filterable by provenance
- feat: fingerprint each run's provenance and group runs by it
- feat: record each stage's own span and its tools' summed metrics
- fix: store symlinks as links in the journal and seed both halves of a staged rename
- fix: sweep leftover apply temps on recovery and drop the unused diff helper
- fix: require an unmodified key for every TUI binding and correct the review pane budget
- fix: bound restoreSnapshot to the candidate policy and make the pre-state durable
- fix: stop treating a post-apply failure as a discard, and refuse retire over an unresolved record
- fix: force-stage the release scope and widen the dirty check to the candidate
- fix: cover the binary change kind, keep case 9 honest, and restore --version
- fix: correct review-pane precedence, scroll semantics and stale-consumer races
- feat: add the mutation review pane and route resolution through the queue
- fix: restore R10.3's allowDirty override and distinguish retire no-ops
- feat: add retirement through the ordinary mutation path
- feat: add skillgantry release
- fix: close four review findings in the release state machine
- feat: add the release stage and its state machine
- fix: stamp deprecated_at on the skills upsert's conflict branch too
- feat: make SKILL.md frontmatter the lifecycle authority and the ledger a cache
- fix: prove symlink preservation, narrow evidence fallback, drop env cast
- feat: package the candidate, prove it installs, and bundle the evidence
- fix: preserve line endings and changelog spacing in release editors
- feat: add the release decisions as pure modules
- fix: settle the sandbox record on every mutation path, not just apply/discard
- feat: open the mutation sandbox in the pipeline and move authorisation into the engine
- fix: don't revert an already-applied mutation during recovery
- feat: detect and resolve an interrupted mutation on startup
- fix: fsync the journal backup and record before mutating live targets
- feat: add the journalled apply and the preimage recheck
- fix: route snapshot sandbox exclusions through the candidate manifest
- feat: add the snapshot mutation sandbox and the strategy dispatch
- feat: add the git worktree mutation sandbox
- fix: rewrite only diff header lines instead of a global path substring replace
- feat: add the mutation sandbox contract, one diff renderer and the active-sandbox record
- fix: probe unzip with -v, not --version, in the mutating preflight
- feat: add the mutation-aborted error kind and the mutating preflight
- fix: give the tool-outcome gate a severity fail floor
- ui: improve the TUI layout
- feat(cli): install skillgantry onto the user's PATH
- feat(adapters): add skill-scanner in its only mode, LLM
- feat(cli): report a pending rule-map migration and apply it on request
- fix(stages): resolve stage policy from the whole selection
- fix(ledger): count occurrences across a run, not per tool run
- feat(adapters): add skill-up and the shared v1alpha1 eval parser
- feat(adapters): add skill-lint, parsing its JSON report from stdout
- feat(ledger): map every skillspector static rule and version the map
- feat(tools): drop promptfoo from the catalogue
- feat(cli): add the setup subcommand and route first run to it
- feat(tui): add the setup wizard over the four setup states
- feat(tools): add the re-enterable setup state machine
- feat(cli): add the doctor subcommand
- feat(tools): report every drift kind from the lock and the tool root
- feat(tools): dispatch installs over all three kinds
- feat(tools): add the gh-release driver with declared integrity
- feat(tools): add the npm-prefix install driver
- feat(tools): probe runtimes and name their official install command
- feat(tools): catalogue the installable tools and their presets
- feat(cli): launch the work screen when no subcommand is given
- feat(tui): show the queue on the work screen with per-job cancellation
- feat(tui): back the findings, artefacts and SKILL.md panes with real files
- feat(tui): render the work screen from live engine state
- feat(tui): reduce core events into one screen state
- feat(tui): bound live log output in a ring buffer outside react
- feat(tui): add the ink toolchain and enforce the core surface boundary
- feat(runner): emit redacted output chunks while a tool runs
- feat(workspace): log lock reclaims and prove finalisation across processes
- feat(queue): cancel queued and running jobs through the handle
- feat(queue): drain a batch through a bounded pool with a single mutation slot
- feat(pipeline): gate mutating stages on a correlated, timed prompt
- feat(pipeline): cancel in any phase and still finalise the run

## 0.1.0 — 2026-08-01
- fix(cli): declare the exit code the run command sets
- feat(cli): add the headless run command with JSON output and exit codes
- fix(ledger): widen the candidate row cast so tsc accepts it
- feat(pipeline): run stages over an event stream with a run handle
- feat(ledger): add issue transitions, scoped reconciliation and the run transaction
- feat(ledger): add the schema, connection and merge-first fingerprint
- feat(workspace): write the sidecar layout with locked append-only finalisation
- feat(stages): execute adapter-backed stages with per-tool isolation
- feat(stages): add a total tool-to-stage outcome reduction
- feat(adapters): implement the skillspector adapter against a real fixture
- feat(adapters): parse SARIF and rebase paths onto the repo root
- feat(adapters): add the adapter contract, rule-class map and registry
- feat(runner): spawn tools with process-tree kill and artefact loading
- feat(runner): scrub secrets on the write path across chunk boundaries
- feat(config): load credentials and derive redacted provenance
- feat(tools): install and verify uv tools into a managed tool root
- feat(config): add config and tool lock stores with path canonicalisation
- feat(discovery): define the candidate manifest and digest it
- feat(discovery): discover skills and resolve workspace paths
- feat(discovery): parse SKILL.md frontmatter without throwing
- feat(core): add shared types with a closed metric key set
- feat: scaffold package with enforced import boundary
