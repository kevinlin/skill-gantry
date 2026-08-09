# SkillGantry — Design: terminal interface

**Layer:** design (layer 2 of 3: [requirements](requirements.md) → design → plan)
**Traces to:** [requirements.md](requirements.md), [design.md](design.md), [decision-log.md](decision-log.md)

§14 of [design.md](design.md), split out when that document passed 1600 lines: no core change reads any of it, and the section numbers are cited from 30 places in `src/tui/**`, so they are kept exactly as they were. Every `§n` below with no file named is design.md's; every §14.x is this file's.

---

## 14. Terminal interface

*Satisfies R11.1–R11.6.*

One store fed exclusively by core events; Ink components are pure functions of it. Commands flow back through `RunHandle` and `QueueHandle`.

A run in flight, with the Log tab up and the terminal too short for §14.6's Overview card:

```
SkillGantry 8 skills · 1/2 running
┌─ Skills 1/8 · 1 marked ──┐┌────────────────────────────────────────┐
│ ▸ ◐ declawed             ││  Validate  Evaluate  Security  Opt  Rel│
│   ○ gap-analysis         ││  passed    failed·2  running   ·    ·  │
│  *! spec-lint            │├────────────────────────────────────────┤
│   ○ zuhlke-slides        ││ 1 Log 2 Findings 2 3 Issues 3 4 Art 5 S│
│  rows 1–4 of 8 · j/k     ││ skillspector: scanning scripts/scan.py │
└──────────────────────────┘└────────────────────────────────────────┘
┌─ Queue 1/2 running · 2 waiting · +1 more ──────────────────────────┐
│ ▸ ▶ running  declawed  validate,security              0m 42s       │
└────────────────────────────────────────────────────────────────────┘
j/k move · space mark · r run · x cancel · y copy · ? help · q quit
```

Render discipline, the whole mitigation for choosing Ink: `tool:output` chunks enter a per-tool-run ring buffer of 2000 lines held **outside** React. A 100 ms tick copies the visible window into state. Every other pane re-renders only on discrete state change. Log text never enters component state line by line.

The output pane shares a focus stop with the rail — the three zones and why they are three are §14.6's — and `j`/`k` scroll whichever tab is up, except in Findings, where they move that pane's cursor (§14.6). `AppState.outputOffset` is the first visible row, or `null` for "wherever this tab naturally sits": the top of a findings, artefact or SKILL.md list, the newest line of the log. Null rather than a number because an offset pinned at the tail stops being the tail the moment the next line lands, so a log scrolled back to its newest line resumes following instead of freezing one line short. Scrolling the log reads the same flushed window R11.4 already puts in state and adds no path from the ring buffer into React. `outputWindow()` in `src/tui/rows.ts` is the one place the window is derived, because the pane renders against it and the key handler clamps against it — two derivations of that arithmetic is how `j` stops several rows before the end and every further press does nothing.

Screens: Work (above), Dashboard (ledger aggregates), Issues (cross-repo table with state transitions), Tools (install, pin, verify, doctor), Settings (§14.2: every setting's value, holding file and origin, editable through one staged document). Vim-style movement, `?` for help, `:` for a command palette. The queue is a panel on Work, showing `QueueHandle.snapshot()` with per-job cancel.

The palette is the screen switcher: `:` opens it, typing filters the command
list, `enter` runs the selection and `esc` cancels. Direct keys were rejected
because Work already spends `1`–`5` on its output panels, and a second digit
scheme reading differently per screen is how a keymap becomes unguessable.
`esc` on any screen other than Work returns to Work.

**A suppressed issue is marked, never hidden** (R8.15). The Issues row carries `⊘ suppressed: <reason>` on its trailing field, beside the existing `⟂ blockers` precedent, and renders dimmed; the panel title gains `· N suppressed`. Zero new rows, zero new keys — §14.1's budget is what that constraint exists for — and the mark survives `truncateMiddle`, which elides the head. The glyph is paired with the word, so a monochrome terminal loses nothing. A suppressed finding in the Findings pane carries the same glyph on its existing row.

Dashboard, Issues, Tools and Settings each render one `Panel` whose body is
windowed against `layout.rows` by `screenBodyRows()`, so §14.1's four rules hold
on them as they do on Work and on help, and each builds its body as a flat row
list through a pure function in `src/tui/rows.ts` — which is what lets the row
budget be asserted without rendering Ink.

#### 14.1 Responsive layout

`layoutFor(columns, rows)` in `src/tui/layout.ts` is the single place pane sizes are decided, and it is pure: `Work` reads `useWindowSize()` and passes the result down. Nothing in the tree carries a fixed height. The fixed sizes it replaced (a 12-row log, a 5-row queue, a 24-cell skill column) rendered 26 rows into an 80×24 window and scrolled the header away.

Three modes, by terminal width, with the skill list, rail and pane visible in all of them (R11.1):

| Mode | Width | Layout |
|---|---|---|
| `standard` | ≥ 110 | list beside the rail, 18% of the width as the column, 26–34 cells |
| `standard` | 76–109 | as above, 22-cell column |
| `narrow` | 50–75 | list stacked above the rail, borders dropped |
| `too-small` | < 50 or < 14 rows | the required size, and nothing else |

The two width bands above 76 differ only in how much width the skill column gets, so they are one mode. `mode` names the branches `Work` actually takes; a fourth name that no code read invited a `mode === 'wide'` branch that would have meant nothing.

Narrow drops the borders rather than the panels. Four bordered boxes cost fifteen rows of chrome in a stacked column, which leaves nothing for content in a 60×20 split; titles alone cost eight. That is what `chrome: 'boxed' | 'bare'` selects, and `Panel` is the one component that reads it.

Four rules keep a frame inside its budget, each learned from a row that overflowed it:

- **Every panel renders exactly the rows it was allocated.** An overflow count (`+5 more`) or a footnote (`4 earlier lines dropped`) is counted *against* that allocation, never appended below it. One extra row pushes the panel beneath it off the bottom.
- **Text truncates, never wraps.** Content rows carry `wrap="truncate"`, and labels are cut with `truncate()`, which measures cells through `string-width` so a CJK skill name cannot overflow its column by its own width. `truncateMiddle()` is its head-elided twin, for paths whose basename is what identifies them.
- **What the chrome costs is `layout.ts`'s to know, not each pane's.** `innerWidth(width, chrome)` is the single expression of `Panel`'s border and padding. Three panes each re-deriving `width - 4` meant a change to `Panel`'s padding would silently truncate every label to the wrong width, with nothing failing. §14.6 moves a titled panel's heading into its top border, which takes `BOXED_CHROME` from 11 to 10 and makes an explicit width mandatory for such a panel — both are decisions of this module, for this rule's reason.
- **The rail and the output pane share one horizontal rule** (`borderTop={false}`), because two adjacent boxes each drawing their own spent two rows on one seam.

Every full-screen view obeys the budget, including the help screen: it renders through `Panel`, windows its binding list against `layout.rows`, and reports what it cut. Drawing its own fixed-size frame scrolled its own title away on a 50×14 terminal. The wizard is the one view sized independently — it is inline rather than full-screen — but its width is still a `layout.ts` decision (`setupWidth`), never a constant in the component.

Discoverability is layered rather than crammed into the header: a footer hint bar, `?` for the full binding list. That footer is one component, `StatusBar`, rendered by every screen — keys left, `v<version>` right, no screen composing its own, because eight hand-rolled copies of one row is how the Issues footer came to omit `q quit` while `q` quit from there. The version rides that row rather than taking one of its own and is dropped whole when the keys will not fit beside it, since truncating the keys defeats what the footer is for; it is read from `package.json` through `core/version.ts`, the same source `skillgantry --version` reports.

The Work screen renders on the alternate screen so a session does not bury the user's scrollback; `skillgantry setup` stays inline, because it is summon-choose-exit and its result should remain in scrollback. §14.2 renders the same wizard a second time as a full screen inside the session, where the alternate screen and the row budget both apply — the states and the component are shared, the framing is the caller's.

#### 14.2 Settings: viewing and editing the configuration

*Satisfies R11.7, R11.8.*

M6 shipped Settings read-only and recorded why: an editable screen would be a second write path to `config.json` with no requirement asking for one. R11.8 is that requirement, and the "second write path" is what this section is arranged to prevent — there is one staged document, one validation, one write.

**The view names the file, not just the value.** Rows are grouped by the file that holds them, and every editable value carries its origin: the file, a built-in default, or a session override.

```
Repos                            ~/.skillgantry/config.json
  zapac        20 skills  git    /Users/…/zapac-agent-skills
Execution                        ~/.skillgantry/config.json
  concurrency        4           config.json  (session 2, via --concurrency)
  artefact cap       32 MiB      default
  mutation timeout   5m 00s      config.json
  validate           skill-lint  config.json
Credentials                      ~/.skillgantry/.env          read-only
  skillspector       ok  via anthropic
Ledger and tools                 ~/.skillgantry/gantry.db, tools/lock.json
```

Origin costs a second read of the raw file, because `loadConfig` parses through the schema and the schema substitutes a default for every absent key — by the time the config reaches a screen, a value the user wrote and a value nobody wrote are the same number. `settings()` therefore reports which top-level keys were literally present. Without it the screen invites a user to edit a file that does not contain the setting they are looking at.

**Three edit paths, one staged document.** Every path writes into a staged `GantryConfig` held in the app store, seeded from the loaded one. Nothing touches disk until the change set is confirmed.

| Path | Key | Covers |
|---|---|---|
| The setup states, as a screen | `:setup`, or from a Settings row | `stageTools`, `repos` additions |
| Inline value editor | `e` on a selected row | `concurrency`, `artefactSizeCapBytes`, `mutationTimeoutMs`, `timeoutOverridesMs` |
| Repo removal | `d` on a repo row | `repos` removals |

`version` is not editable: it is the schema's own literal, and a user who could change it could only make the file unloadable. `timeoutOverridesMs` is a record rather than a scalar, so the screen renders one row per selected tool carrying its effective timeout — the adapter's default or the override — and editing that row stages an override while clearing it removes the key. A record with no row per key would let a user see an override and have no way to take it back off.

The setup states are the same `setupReducer` and the same `Setup` component `skillgantry setup` renders; `Screen` gains `setup`, so the palette entry follows from the screen list rather than being a second registration. Two things follow from re-entering a wizard written to run once on a clean machine, and both apply to the inline wizard too. Its initial state is seeded from the current selection, since an empty `selected` renders as "no tool chosen" and makes an unchanged pass look like a request to clear every stage. And its install step marks a tool already locked at its pin and verified as `ok` without reinstalling, since changing one tool otherwise reinstalls the whole selection.

Removal takes the repo out of the configuration and nothing else. Workspaces, sidecar evidence and ledger rows survive, so re-registering the same path finds its history — and the confirmation says so, because "remove" over a path otherwise reads as a delete.

**The change set is semantic, not textual.** `unifiedDiffFor` spawns, and `src/tui/**` may not; more to the point a line diff of a JSON document reports an array edit as a block move, which is not what the user did. `configChanges(current, staged)` is pure, lives in core, and emits one row per changed field:

```ts
interface ConfigChange {
  kind: 'add' | 'remove' | 'change'
  /** Dotted field path, e.g. `stageTools.validate`, `repos[zapac]`. */
  path: string
  before: string | null
  after: string | null
}
```

There is no per-row "needs a restart" flag, because today it would be `true` on every row: `startTui` closes over the tool selection, the lock, the environment and the caps, `createQueue` captures the pool size, and the skill list is resolved once. The pane states it once over the whole change set, which is what R11.8 asks for while the answer is uniform; a field that later becomes live-rebindable is what would reintroduce the flag, carrying information rather than restating a constant per line.

The confirm pane is a sibling of `ReviewPane`, not a generalisation of it: both are `Panel` bodies under §14.1's budget, but one renders diff text and the other change rows, so a shared component would be a switch with two disjoint halves. `a` applies, `d` discards, `j`/`k` scroll — the same three keys the mutation review already trains.

**What the gate does not cover.** Installing a tool spawns an installer and writes `tools/lock.json` before any configuration changes, and no confirmation can undo that. The change set covers `config.json` alone and names that file in its title. `.env` is neither staged nor rendered into a change row (R7.3), which is why credentials are a view-only group rather than an editable one that refuses.

**Applying rebinds nothing that is already running**, because a queued job carries the plan it was admitted under and a run whose provenance and tool lock were recorded under one configuration but executed under another would make the ledger's own record untrue — a worse failure than waiting for a restart. Apply writes the file, re-reads it into the view, and marks each change the session will not honour until relaunch.

**Where the decisions live.** The transforms are decisions over a document, so they stay out of the module that owns the file: `withRepo`, `withoutRepo`, `withStageTools` and `withScalar` are pure functions in core, `registerRepo` becomes its filesystem half plus a call to `withRepo`, and the staged path and the live path can no longer disagree about id uniqueness or duplicate rejection. The terminal interface reaches the write through one new port method, `applyConfig(next)`, which validates and saves; the transforms and `configChanges` are pure and need no port.

Modal precedence is fixed and ordered by what a keystroke can destroy: the mutation review first, because its `a` writes the user's repo; then the config confirmation; then the setup screen; then the palette; then the detail view of §14.8, whose keys destroy nothing and which must not outrank the suppress pane its own `s` opens; then help.

### 14.3 Copying a fix prompt

*Satisfies R11.9.*

`y` on the Work screen copies the §9.4 fix prompt for **the stage that produced the selected finding**, falling back to the lifecycle rail's selected stage when the Findings pane holds no selection — the vim yank verb, unbound before this. It sits in `useInput` after the Work-screen gate and before the `r` handler, so every modal above still wins its keystroke.

The first cut of this bound `y` to the rail alone, on the grounds that a finding on screen could not be attributed to a stage at all. §14.6 retires that reasoning rather than the rail: `FindingRow` carries the stage its finding came from, which the reducer had in `event.stage` all along, so a selected finding answers the question better, and the rail — whose selection `h`/`l` already move, which is what makes `y` work from any output tab — stays the fallback. `StageCell` gains a `findings` count, set from the `stage:done` event that already carries the whole `StageResult`, so no event contract changes either way.

**The OSC 52 write lives in `src/tui/`.** The escape has to reach the terminal Ink currently owns — alternate screen, raw mode, the stream Ink was constructed with — and `src/cli/tui-command.ts` hands control away at `startTui` with no live handle on the keystroke. The lint rules ban `console` and `process.exit` in **core**, not stdout writes in the renderer; writing stdout is what the renderer is. Encoding is split into a pure `osc52.ts` so the byte shape is testable without a terminal, base64 over **UTF-8** explicitly — a non-ASCII character in a finding message corrupts a `binary` payload. It returns null above a size cap so the caller can never report a copy that did not happen. The write goes through `useStdout().stdout.write`, not Ink's `write()` helper from the same hook: that one writes above the app and forces a clear-and-re-render, flickering the frame for a sequence that renders nothing.

**The path is surfaced at zero row cost.** Terminal.app, and tmux without passthrough, discard OSC 52 silently, so an action reporting only success is one the user cannot trust. `AppState` gains a `flash` that the Work screen passes to `StatusBar` in place of the hint text — the footer already occupies that row on every screen, so §14.1's budget is unchanged. It names the path in each unavailable case too: no recorded run, a stage that found nothing, a file not written yet, a body over the cap. The first case says `press r` rather than offering `skillgantry fix`, because §14.5 now presents a recorded run, so what remains is a skill that has never run at all — where that command would exit non-zero too. The flash clears on the next keypress rather than on a timer, which keeps the TUI tests deterministic, and the path is cut with `truncateMiddle` so the basename survives.

The Findings pane gains **no** footer row: `outputWindow()` already spends rows on `overflow` and `dropped`, and a third footnote would cost the findings list a row on every render, paying the budget permanently for a static hint. `HINTS` carries `y copy` as its seventh pair, which measures 67 columns and so still fits beside the version at the 80-column floor; an eighth would cost the tail, `q quit`. The help screen's `KEYS` row is the second tier.

### 14.4 Watching a run, and being told when it lands

*Serves R11.6's queue panel and the fourth product principle: the maintainer is watching a long-running process.*

A real eval iteration ran 1m54s, and a stage's log can go silent for most of that. Everything below is bought at zero row cost, because §14.1's budget does not relax for reassurance.

**The queue row says how long.** `JobRecord` already carries `startedAt` and `endedAt`, so a running job counts up and a finished one holds what it cost — no new state, no core change. The verdict word gets a fixed column (`VERDICT_WIDTH`, derived from the two colour maps rather than counted by hand) so the time lands in one place down the panel, and the label is padded with `padCells`: `padEnd` counts code units, so a CJK name was padded to half the column it needed and pushed every value right of it out of line. A job that has not started shows nothing, since twenty rows counting how long they have waited is noise around the one that is working.

**The row names the verdict, not the job's lifecycle.** The pool ends every run that *completed* as `done`, a security stage that found criticals included, so a row rendering `job.state` painted that run green while the rail one panel up said `failed`. `jobVerdict()` in `tokens.ts` is the single resolution: state for anything unfinished and for a run that threw (`failed` as a state means the run itself failed, which no stage outcome describes), outcome for anything that did.

**The running mark turns.** `SkillList` rotates the `◐` it already uses rather than adding a spinner beside it, so the column stays one cell; phase 0 is the resting glyph, so a terminal that never repaints loses nothing. `useTicker(active)` runs an interval **only while something is running** — one left alive on an idle screen re-renders the whole Work tree forever to animate nothing — `unref`s it so `q` never waits on a decoration, and restarts from zero each time it wakes, which lets a test assert on the first frame without holding the clock.

**A settled queue reports itself in the footer**, on the row §14.3 established. Raised when the queue *empties*, not per job: a batch of twenty reporting twenty times would hide the footer's keys for the whole run, and what the user left the terminal to find out is whether it all passed. One job reports in full — verdict, elapsed, finding count, run directory — because that is the case where the evidence has a single address to name; a batch reports a tally by verdict, worst first, or a batch that found criticals reads as `4 passed`. Verdict first and the path last, since `StatusBar` cuts from the end and a narrow terminal should lose the address before the answer. `flashTone` is only ever set with the message, so the two cannot describe different events.

### 14.5 Rehydrating the last recorded run

*Satisfies R11.10.*

Every field of `SkillRow` but one was a pure function of the session's queue event stream, so relaunching against a skill with four recorded runs rendered an empty rail, an empty findings list, an empty artefact list and a `y` that refused. `loadSkillStatuses` was the single launch-time read, and it fed the skill-list glyph alone — which is what made the empty rail beside a red `!` read as a bug rather than as a blank slate.

**The sidecar, not the ledger.** R8.2 makes the sidecar the evidence and the ledger a queryable index of it; the screen already knows which skill is selected, so no cross-skill query is needed; and `src/tui/**` may not open the ledger at all. Same reasoning `skillgantry fix` records, and the same resolution rule: the greatest run id in `index.ndjson`, never the `latest` symlink, which is absent mid-write. `newestRunId()` in `views.ts` is that rule's one expression, called by both `loadSkillStatuses` and `loadLastRun`.

**Lazily, per selected skill.** One index read plus at most five `stage.json` reads, on selection. Eagerly at launch over 54 skills is 270 reads to fill four rows on screen. It matches the SKILL.md and artefact panes, which already load on selection, and re-uses their effect's shape.

**The reducer holds the precedence rule, not the effect.** The read is async, so an `r` pressed while it is in flight must not have its live run clobbered by a response that resolves after `run:start`. `run:start` sets `activeRunId` and `runDir` together, so `set-last-run` refusing a row where either is set is both R11.10's precedence rule and that race guard, in one condition evaluated at dispatch time rather than at read time. `status` is left alone: `set-statuses` already owns it from the same index.

**The Log pane replays per skill, not through the buffer.** `state.log` is one session-wide ring buffer while everything above is per-skill, so seeding it is ambiguous the moment one skill runs and another is selected. Leaving the pane unreplayed and naming the run's directory instead was worse: four panes had loaded and the fifth named a path, which reads as a pane that failed. So the buffer is not used. `SkillRow` carries `recordedLog` and a `rehydrated` flag; `logLines(state, skill)` in `rows.ts` resolves which of the two the pane shows, and `run:start` clears both, which is where the live buffer takes the pane back. Because recorded lines never enter `state.log`, a skill that has not run this session cannot display whichever skill did — and R11.4 is untouched, since no new path runs from the ring buffer into React.

`logLines` and `logDropped` sit beside `outputWindow` for its reason: the pane renders against those lines and the key handler clamps against their count, so a second derivation is how `j` comes to stop short of the end. The replay carries the tool-id prefix the pump writes, so a recorded frame and a live one read identically; it is capped at `LOG_CAPACITY` keeping the newest and reporting the rest through the footnote R11.5 already spends a row on; and the two streams are ordered stdout-then-stderr per tool rather than merged, because the pipeline writes them as two files and their true interleaving is not on disk. The empty case now means the run's tools wrote no log at all, and still names the directory.

Read-only throughout. The pipeline stays the only writer under `runs/`, which is the constraint R11.10 shares with R12.6 and for the same reason: a screen that answers for a run must not rewrite that run's evidence.

### 14.6 The Work screen overhaul

*Satisfies R11.11–R11.15.*

Derived from D20–D23. §14.3 through §14.5 each extended this screen in place; this is the pass over the assembled frame, and every gap it closes was visible only with all four extensions on screen at once.

The same screen idle, with a finding selected and the card at its `compact` tier — §14's frame is the other state, not a second claim about this one:

```
SkillGantry 18 skills · 0/2 running
┌─ Skills 7/18 · 1 marked ─┐┌────────────────────────────────────────┐
│ ▸ ● declawed   ✓ marked  ││  Validate  Evaluate  Security  Opt  Rel│
│   ○ gap-analysis         ││  failed·3  passed    failed·1  ·    ·  │
│   × spec-lint    1 open  │├────────────────────────────────────────┤
│   ○ ui-lab               ││ 1 Log 2 Findings 4 3 Issues 7 4 Art 5 S│
│  rows 3–8 of 18 · j/k    ││▸high  prompt-injection  SKILL.md:58 sk…│
└──────────────────────────┘│ │ Instruction block interpolates       │
┌─ Overview  every repo ───┐│ │ untrusted issue text verbatim.       │
│ validate ▕███████░░░▏ 89%││ │ injection.untrusted-interpolation    │
│ evaluate ▕███░░░░░░░▏ 29%││ │ [o] open report   [y] copy prompt    │
│ security ▕██░░░░░░░░▏ 21%││ medium excessive-permissions SKILL.md:3│
└──────────────────────────┘└────────────────────────────────────────┘
┌─ Queue  1 marked · idle ───────────────────────────────────────────┐
│ ▸ ○ ready  declawed  validate,evaluate,security                    │
└────────────────────────────────────────────────────────────────────┘
j/k move · space mark · r run · x cancel · y copy · ? help · q quit
```

**Three zones, and the keys belong to them** (R11.11). `FOCUSES` is `['skills', 'work', 'queue']`: the rail and the output pane are one zone, because `h`/`l` and `j`/`k` already tell them apart inside it, and a stop that only disambiguates keys which were never ambiguous is paid for on every cycle. `h`/`l` no longer fire globally — the rail describes the *selected* skill, so a user moving down the list was moving the rail with it and nothing on screen said so. `space` was already zone-aware, so it needs only its zone renamed; `markedStages` and `r`'s reading of it are untouched. One `focused` flag lights both boxes of the merged zone, which is what makes it visible.

The digit keys were the exception that proved the rule wrong, and R11.11's rev-15 clause resolves it: `1`–`5` set the panel **and** focus the work zone, from wherever they are pressed. Reading them as screen-level keys licensed the very action at a distance the zone rule forbids, and scoping them strictly would have cost a `Tab` to reach a pane the key already names — a key that moves you to what it selects is neither. `S` is scoped the other way, to the work zone with the Issues tab up, matching the `o` and `s` guards beside it: cycling the issue scope from the Log tab changes state nothing on screen reflects. `0`, `r` and `y` stay screen-level and are not exceptions to anything: `0` leaves the screen, `r` acts on the marks rather than on a zone, and `y` already falls back to the rail when no finding is selected, so it answers in all three. `←`/`→` join `↑`/`↓` as aliases of the letter pairs; the vertical pair had been aliased in eight blocks since M2 while the horizontal pair was bound nowhere, which is not a decision anyone made.

**A titled boxed panel draws its own top border** (R11.12's funding). `Panel` emits `┌─ Skills 7/18 · 1 marked ─────┐` as one row and passes `borderTop={false}` beneath it, so a titled panel costs a border row and a title row where it used to cost both plus a body row. `SkillList` and `QueuePanel` both stop spending that row, but only `QueuePanel` is on the frame's vertical path — `SkillList` sits in the *left* column, beside the rail, so its row is left-column slack. `BOXED_CHROME` drops 11 → 10, and the card is funded by that slack plus the row `outputHeight` gains, which is why the chrome change is neither cosmetic nor optional.

The title row's furniture is five cells: `┌`, `─`, a space, the label, a space, `┐`, measured through `string-width` rather than counted in code units, since a CJK title is two cells per unit. The constraint that follows: **a titled boxed panel must be given an explicit width.** The title row and the box below it are two independent renders, and a one-cell mismatch puts the `┐` a column off the `│` under it — a torn corner rather than a layout bug. Every titled call site is therefore passed `layout.columns`, and `PanelProps` makes `width` required whenever `title` is set so the compiler catches the next one. `bare` chrome keeps the title as a body row, having no border to embed it in.

**The Overview card is sized by rows, not by columns** (R11.12). `layoutFor` gains `overview: 'full' | 'compact' | 'none'` and picks the largest tier leaving `SKILL_LIST_MIN` rows in the list. `full` is six rows: one bar per gate stage, the issue summary, the slowest stage's median, and the dashboard link. `compact` is four: the bars, and that link. The link sits on both tiers because a key advertised on the largest tier alone is a key most terminal heights never show, and it reads `[0] full dashboard →` rather than `0  full dashboard →` because the rows above it open with counts and a bare digit in that column is read as one more. The row costs `OVERVIEW_ROWS.compact` one, which moves exactly one boundary — at 21 rows the card no longer fits and drops to `none`. The panel's `hint` was the free alternative and does not work: `Panel` truncates the title first and gives the hint whatever is left, so at the 22-cell column the entire 76–109 band uses, `0 dashboard` renders as `0 dashb…`. `OVERVIEW_ROWS[tier]` and the row count `overviewRows` emits are asserted equal, because until this change they agreed only by coincidence — `GATE_STAGES` is three long — and a tier allocated a row its builder never fills fails silently in a direction no frame assertion catches. Both the bar's cell count and the label's width are derived from the width, and the label shortens first — `sec` still names the stage, while a two-cell bar shows no proportion at all; reserving a constant instead cut off the percentage at a 22-cell column, which is the one number the bar exists to quantify. Rows and not a width band because the card competes for the left column's height: a 200×20 terminal has cells to spare and nothing to give. `standard` only; `narrow` stacks the list above the rail and has no column for a card. `overviewRows(stats, tier, width)` and `bar(pct, cells)` are pure and sit in `rows.ts` beside `dashboardRows`, so every tier boundary is asserted against `layoutFor` rather than at a named terminal size — a later change to what the chrome costs would move the boundary and break a test that was describing arithmetic rather than a rule. The card's data is one unfiltered `views.dashboard({})`, read at launch and on `:refresh`; `0` goes to the Dashboard screen rather than becoming a sixth entry in §14.2's precedence order.

**A finding carries its stage and its tool** (R11.14). `SkillRow.findings` becomes `FindingRow[]` — `{ finding: RawFinding; stage: Stage; toolId: string }` — both fields already in hand where the reducer appends them, in `event.stage` and `event.result.toolRuns[].toolId`, so no core contract moves. That is what retires §14.3's reason for having no per-finding cursor. `findingRows(state, skill, width)` emits a flat row list *including the selected row's detail* and `outputWindow` windows that list, so the expansion is simply more rows and the pane and the key clamp keep sharing one derivation — the `j`-stops-short failure §14 and §14.5 have each paid for once. The cursor indexes findings while the window counts rendered rows, which is why the tab supplies a `cursor` row for the window to contain rather than an anchor to sit at: clamping the cursor against the row count walks it past the last finding, and `anchor: 'top'` cannot keep it in view. Log, Artefacts and SKILL.md keep their scroll semantics and `outputOffset` stays `null` for them.

The detail names the message, the rule class, the native rule id, `ToolRunRecord.artefactDir`, and the tool's suppression justification when there is one — R6.10's rationale at the screen: the normalised record holds six fields, so the SARIF `properties` that explain and remediate a finding reach no surface at all. The screen's job is to reach that evidence, not restate it, so `o` opens the directory through **`openPath` on `GantryViews`**. The directory rather than a file, because native artefact names belong to the adapter and a screen naming `findings.sarif` would be guessing at four tools' conventions, while `artefactDir` is recorded per tool run and always exists. On `GantryViews` rather than a new port because it is already the terminal interface's one injected dependency and already carries writes in `actOnIssue` and `applyConfig`; a port at all because `src/tui/**` may not spawn. `y` copies the prompt for the stage that produced the selected finding (R11.9 as amended). No key applies a change to the skill: R11.14 restates R6.10 here precisely so a per-finding action row cannot quietly acquire a fixer, which is what the study proposed and D21 refused.

**Issues on the output pane triages; the screen acts** (R11.13). `PANELS` becomes `log, findings, issues, artefacts, skill` on `1`–`5`, and the guard reading `'1'`–`'4'` is the single place that changes. `S` cycles the scope over the selected skill, its repo, and every registered repo, resolving onto `IssueFilter`'s existing `skillId`, `repoId` and unfiltered forms — no ledger change. The tab carries its own cursor, `selectedTabIssue`, which `outputTab` reports the way it already reports `selectedFinding`. It had been rendering the Issues *screen*'s cursor while windowing against `outputOffset`, so it drew a selection no key on the Work screen could move and, arriving from a screen left at row 30, drew none at all. Both surfaces still read one `state.issues`, so whichever query resolved last replaced the other's rows beneath a cursor `set-issues` clamps rather than resets: `set-issues` therefore carries the surface that asked, and the effect serving the Issues screen gained the `live` cancellation flag the tab's effect has always had. Two cursors and a tagged response are what keep one row set from being observable as one. The Issues screen's row building moves to `issueRows()` in `rows.ts` and both surfaces render through it, because one issue rendered two ways by two modules is the divergence `tokens.ts` records from when five modules owned severity colour. The tab binds no state transition: `o` on this pane already means "open the report", and one pane whose key means two things across two of its own tabs is a keymap that cannot be learned.

**Colour for state; the terminal's own for surfaces** (R11.15). `tokens.ts` takes D23's hex — `ACCENT` `#0070f3`, passed `#00c853`, failed `#ee0000`, errored and degraded `#f5a623`, skipped and idle `#555555`, critical and high `#ee0000`, medium `#f5a623`, low and info `#888888` — and chalk downsamples where there is no truecolour. No body foreground and no background is ever set, which is why the screen reads on a light theme and what the study's own `#ededed` body text would have broken. A selected row is `inverse` over text `padCells`-padded to the pane's inner width: reverse video swaps the inherited pair rather than replacing it, and the padding is load-bearing, since Ink's `inverse` covers only the characters rendered and an unpadded short row highlights a stub instead of a band. `▸` stays beside it, because a monochrome terminal keeps the cursor when it loses the attribute.

**Not adopted from the study, and why.** Applying a fix (D21: no tool reports the patch, so SkillGantry would author it, and R6.10 exists because the two findings that prompted it were unsafe to apply mechanically). Suppressing a finding (D21: a repo write, so §12's gate, an adapter-declared baseline path and shape, and an amendment to R8.15's authority clause — M8, not a footnote to a pane; §14.7 is that milestone). The rail's per-column left border rule (a cell per column to say what `underline` and `bold` already say). Deleting the sibling screens (D20: R11.3, and M6's settings editor is already palette-only). And the study's header, which adds an open-issue count and the repo name: cheap, probably right, and no requirement asks for it — recorded here rather than smuggled in through a diagram, because a frame drawn in a spec is read as a promise.

### 14.7 Accepting a finding

*Satisfies R11.16, R11.17.*

Derived from D24–D27. M6 taught SkillGantry to *read* a tool's suppression file; writing one was still a manual YAML edit, which D21 deferred and this section closes. The write itself is design.md §12.5's; what is here is the two ways in and the one confirmation.

**`s` on the Issues screen and on the Work Findings pane.** Free on both today — Dashboard's `s` is its skill filter and the Work screen's issue-scope cycle is uppercase `S`. Two surfaces because the Findings pane is where a maintainer is when they judge a finding and the Issues screen is where they are when they triage the backlog, and both are the same question. The Work screen's Issues *tab* is deliberately not a third: R11.13 forbids that tab binding a state-changing key, precisely so its keymap stays learnable.

The Findings pane has what it needs in hand — `FindingRow` carries `finding.nativeRuleId`, `finding.path`, `toolId` and `stage`. The Issues screen does not, so `GantryViews` gains one read resolving a fingerprint to its detections' native rule ids, taken from the issue's `last_seen_run` rather than from all history: a rule id reported once and not since would otherwise add a rule for a finding that no longer exists.

**The grain is honest about itself.** A skillspector rule keyed on id and path suppresses every occurrence of that rule id in that file. That matches the issue fingerprint's grain — `(skillId, relPath, ruleClass)` — but it is coarser than one finding, so the confirmation says what the rule will cover rather than implying it accepted one row. Narrowing to a single occurrence would need a `message` glob, which breaks the next time the tool rewords its message.

**Refusals and warnings are named before the write.** A finding from a tool with no `baseline` reports `skill-scanner declares no baseline` and points at `w` for wontfix, saying that wontfix does not affect the gate. The harder case is an issue both scanners report: skillspector's rule can be written, but §10.4's conjunction leaves the issue unsuppressed while skill-scanner still reports it, and the security stage still fails. A user who accepts a finding, re-runs, and watches it fail anyway has been misled by the feature that was supposed to help.

**The reason** reuses §14.2's `begin-edit` / `edit-input` / `stage-edit` / `cancel-edit` *shape* rather than those actions — `begin-edit` is typed to `ScalarField`, the config document's vocabulary, and widening it would put two unrelated editors behind one action. What is reused is the part the user learns: a buffer in state, a refusal on commit, no per-keystroke write. Unlike the config editor the buffer is **seeded** with `Accepted <date> via SkillGantry` and the first keystroke appends to it, which is what a prefill is for. Empty is refused — skillspector's v2 schema refuses it too, and the reason is what the Issues row later renders as `⊘ suppressed: <reason>`.

**`SuppressPane`** is a sibling of `ReviewPane` and `ConfirmPane`. It renders diff text, so `ReviewPane`'s diff body is extracted into a shared `DiffBody` used by both: two renderers of one diff is the divergence `tokens.ts` records from when five modules each owned severity colour, and these are the panes whose `a` writes the user's repo, so this is exactly where a colour has to mean what it means everywhere else.

```
┌─ Suppress — skillspector · declawed/scripts/scan.py ───────────────┐
│ --- a/declawed/.skillspector-baseline.yaml                         │
│ +++ b/declawed/.skillspector-baseline.yaml                         │
│ @@ -3,2 +3,6 @@                                                    │
│  rules:                                                            │
│ +- id: MP2                                                         │
│ +  path: scripts/scan.py                                           │
│ +  reason: Alignment whitespace in a re.VERBOSE block, not padding │
│ reason ▏Alignment whitespace in a re.VERBOSE block, not padding▕   │
│ also reported by skill-scanner, no baseline — security still fails │
│ then run: validate, evaluate, security · t cycles                  │
│ recorded gates passed against the previous bytes                   │
└────────────────────────────────────────────────────────────────────┘
a apply · d discard · t then-run · j/k scroll · esc cancel
```

The last two body rows are conditional: the second-detector warning only when one exists, and the R9.9 line whenever the **resolved** stage set does not cover all three gates. Resolved and not the toggle's label, because "resume from the first non-passing gate" already covers all three when validate is the failure, and a warning that release will refuse would then be false. Every row is counted against the pane's allocation, per §14.1's first rule.

Precedence slots **second** in §14.2's fixed order — after the mutation review, before the config confirmation — on that order's own principle, which is what a keystroke can destroy.

**The re-run is offered at confirm time, as a toggle, and defaults to resuming the chain** (R11.17). `t` cycles `resume from the first non-passing gate` → `every gate` → `nothing`; `a` applies and enqueues per the toggle, `d` discards. A toggle rather than three apply keys, so `a` and `d` keep exactly the meaning the mutation review already trains. The acceptance moves the digest, so which stages are now stale is a fact the pane knows and the user should not have to derive.

`resume` resolves to the contiguous chain from the earliest gate whose last recorded outcome is not `passed`, through security — not the literal set of failed stages, because R5.1 halts the chain, so a validate failure leaves evaluate and security at `·` and enqueueing validate alone makes the user press `r` again. Two edge states are defined rather than left to fall out: a stage that never ran reads `·` and counts as non-passing, so a skill with no recorded run resumes from validate; and a skill whose three gates all passed resolves to an empty set, where the toggle starts on `every gate` instead — the right default there anyway, since every one of those passing runs was recorded against the pre-write digest. `resumedGates()` in `rows.ts` is that rule's one expression, pure, so every boundary is asserted without rendering a frame.

Both non-`nothing` settings call `queue.enqueue` — the same call `r` makes, with the same batch shape R5.5 defines. No new run path and no core change. The Issues screen is cross-repo and does not know the target skill's rail, so the pane calls the existing `loadLastRun(skill)` when it opens: one index read plus at most five `stage.json` reads, the lazy-per-selection shape §14.5 already uses.

**The flash says the ledger has not caught up.** R8.15 makes the file the authority and the suppression columns a cache recomputed on conclusive tool runs, so the `⊘ suppressed` mark appears only after the re-run. Without that line the user applies, sees the Issues screen unchanged, and concludes nothing happened.

**Unsuppressing is out of scope**, so undoing means editing the YAML or reverting the file in git. The mitigation is that the diff gate makes a wrong rule visible before it lands, and the file is an ordinary tracked file in the user's repo. If mistakes turn out to be routine, `S` to unsuppress through the same write path is the follow-up.

### 14.8 Reading one finding, or one issue, in full

*Satisfies R11.18.*

§14.6 put a finding's evidence inline and R11.14 counts it against the pane's allocation, which is precisely what makes every one of its rows truncate. At the 80-column floor the pane's inner width is 76 cells and the message row spends four on its indent, so the sentence a scanner actually wrote — the field a maintainer reads in order to decide whether the finding is real — is the one the screen is guaranteed to cut. `enter` opens it whole.

**A full-screen replacement, not an overlay.** Nothing in `src/tui/**` draws over live content: `ReviewPane` and `Help` replace the Work body, `SuppressPane`, `ConfirmPane` and `PaletteScreen` replace the app's. An inset overlay would also be *narrower* than the pane it covered, which is the wrong direction for a view whose whole job is to stop truncating. So `DetailPane` is a `Panel` under §14.1's budget, windowed by `screenBodyRows()` like every other full-screen view.

**Rendered app-level, holding no origin.** `enter` fires from the Findings pane, from the output pane's Issues tab and from the Issues screen, so a Work-local component cannot serve it — `SuppressPane` is the precedent, reached from two of those same three. Opening the view does not touch `state.screen`, so `esc` clears `state.detail` and reveals whatever was already beneath: Work with its rail and cursor where they were, or Issues with its own. An `origin` field would be a second record of which screen is up, and two records of one fact are how they come to disagree.

**It holds the row, not an index.** `run:start` clears `SkillRow.findings` and `set-issues` replaces `state.issues` wholesale, so an index would silently re-point at a different finding while the view was open — and the list it indexed is not on screen to contradict it. Hence `detail: { kind: 'finding'; row: FindingRow } | { kind: 'issue'; row: IssueRow } | null`.

**One pane, two row builders.** `findingDetailRows()` and `issueDetailRows()` in `rows.ts` emit `ScreenRow[]` and `DetailPane` renders whichever it is handed. Two components would be two renderers of one frame, the divergence `tokens.ts` records from when five modules each owned severity colour; and pure builders are what let the row budget be asserted without Ink, the same reason `overviewRows` and `issueRows` already sit there.

**The actions stay live.** `o`, `y` and `s` all work from inside. The detail is where the user has the most context to judge a finding, and refusing the keys there sends them back to the pane to press a key the pane is still advertising. `s` opens `SuppressPane`, which returns to the screen beneath rather than to the detail — one `esc` per pane, not two for one decision. No key applies a change to the skill: R11.18 restates R11.14's prohibition for the reason R11.14 restated R6.10's, so that a fuller surface cannot quietly acquire a fixer.

**Precedence last.** §14.2 orders the modals by what a keystroke can destroy, and this one's keys destroy nothing. That places it after `SuppressPane`, `ConfirmPane` and `PaletteScreen` — and the ordering is forced rather than merely consistent: `s` from inside the detail opens the suppress pane, so a detail that outranked it would swallow the pane it had just summoned.

**The footer carries the actions and the flash.** `o open · y copy · s suppress · j/k scroll · esc close · q quit` measures 60 cells, so it fits beside the version at the 80-column floor. `AppState.flash` renders there exactly as it does on Work, which is where `y`'s OSC 52 path report lands — an action able to report only success is the failure §14.3 exists to prevent, and it does not stop being one on a second surface.
