# Spawn test flakiness investigation

Date: 2026-11-13

## Cause and reproduction

The two timeout cases in `tests/core/spawn.test.ts` started a real shell and
allowed three seconds for both startup and the behaviour under test. If startup
consumed that window, the timeout correctly killed the process before it wrote
`grandchild.pid` or `before-hang`. The assertions then failed with `ENOENT` or
empty stdout. Commit `2c9f2ee` had already increased the tree test's deadline from
one second to three seconds for this reason. Increasing it left the race intact.

The original session failure logs were not supplied. To reproduce this mechanism,
temporarily prepend `sleep 4;` to each of the two fixture scripts, then run:

```sh
pnpm vitest run tests/core/spawn.test.ts -t 'kills the whole process tree|preserves partial output'
```

Both original cases failed with the errors above. Both revised cases passed with
the same four-second startup delay. The injected delays were removed afterward.

The tree test also waited a fixed 300 ms before checking process death, which
assumed the OS would finish reaping the killed descendant within that interval.

An initial readiness-only fix exposed another fixture race under load: a shell
could fork its trailing `sleep` concurrently with the group kill, leaving output
pipes open until the watchdog retried the kill. This happened once in 30 repeated
spawn-suite runs and once in the full suite. Both were caught by the assertion
that timeout must finish without watchdog cancellation.

A separate real-process reproduction killed the group immediately after an
`echo ready`. With `sleep 600 & echo ready; sleep 600`, 197 of 200 runs needed a
second kill after 250 ms to close their pipes. With `sleep 600 & echo ready; wait`,
none of 200 did. These observations support the fork-race explanation; they do
not measure its frequency in the original three-second tests.

## Change

Keep the shell, process group, signals, streams and log files real. Fake only
`setTimeout` and `clearTimeout` in the two timeout cases. Accumulate live stdout
until the fixture signals readiness, then advance the runner's deadline. The
tree fixture signals readiness after writing the descendant PID; the output case
uses its existing `before-hang` line. After readiness, the tree fixture uses the
shell builtin `wait`, and the output fixture uses `exec sleep`, so neither forks
another child in the kill window. Both cases assert timeout rather than
cancellation. The tree case polls for process death with a five-second bound.

A real 20-second abort watchdog bounds readiness failures. Early process exit
produces a readiness error. A `finally` block aborts any remaining run, restores
real timers and awaits completion. The production runner and its API are unchanged.

## Verification

- Baseline: all eight spawn tests passed before the controlled reproduction.
- Delayed startup: both cases failed before the fix and passed after it.
- Final fixtures: both timeout cases also passed with a temporary six-second
  startup delay, exceeding their five-second virtual deadline. The delay was
  removed after this check.
- Final repetition: 50 of 50 spawn-suite runs passed, eight tests per run and
  three concurrent runners, overlapping the full gate.
- Full `pnpm check`: lint and build passed; all 1,756 regular tests and 71
  acceptance tests passed, with two existing acceptance skips. The first
  acceptance run had five npm-cache permission failures across
  `install-cli.test.ts`, `m9.test.ts` and `packaging.test.ts`. The successful full
  gate used a temporary writable `npm_config_cache`, without changing npm config
  or test code.

The checks run locally on macOS with Node 24.15.0 and pnpm 11.21.0. A Linux CI run
has not been performed as part of this investigation.

This change tests a timeout after the fixture's process tree exists. It does not
change the runner's kill strategy for a real tool that forks concurrently with
the signal.
