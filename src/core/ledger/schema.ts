export const MIGRATIONS: readonly string[] = [
  `
  create table if not exists repos (
    id            text primary key,
    path          text not null unique,
    name          text not null,
    is_git        integer not null default 0,
    registered_at text not null default (datetime('now'))
  );

  create table if not exists skills (
    id              text primary key,
    repo_id         text not null references repos(id) on delete cascade,
    name            text,
    rel_path        text not null,
    current_version text,
    lifecycle_state text not null default 'active',
    deprecated_at   text,
    superseded_by   text,
    first_seen      text not null default (datetime('now')),
    last_seen       text not null default (datetime('now')),
    unique (repo_id, rel_path)
  );

  create table if not exists runs (
    id              text primary key,
    skill_id        text not null references skills(id) on delete cascade,
    trigger         text not null,
    started_at      text not null,
    ended_at        text,
    outcome         text,
    skill_digest    text not null,
    git_commit      text,
    git_dirty       integer,
    provenance_json text,
    tool_lock_json  text,
    sidecar_path    text not null
  );

  create table if not exists stages (
    id           integer primary key autoincrement,
    run_id       text not null references runs(id) on delete cascade,
    stage        text not null,
    outcome      text not null,
    verdict      text not null,
    started_at   text,
    ended_at     text,
    metrics_json text
  );

  create table if not exists tool_runs (
    id           integer primary key autoincrement,
    stage_id     integer not null references stages(id) on delete cascade,
    tool_id      text not null,
    tool_version text,
    outcome      text not null,
    exit_code    integer,
    duration_ms  integer,
    artefact_dir text not null,
    error_kind   text
  );

  create table if not exists issues (
    fingerprint      text primary key,
    skill_id         text not null references skills(id) on delete cascade,
    rule_class       text not null,
    rel_path         text not null,
    severity_max     text not null,
    state            text not null,
    note             text,
    occurrence_count integer not null default 1,
    first_seen_run   text,
    last_seen_run    text,
    closed_run       text,
    reopened_run     text
  );

  create table if not exists issue_detections (
    issue_fp        text not null references issues(fingerprint) on delete cascade,
    tool_run_id     integer not null references tool_runs(id) on delete cascade,
    ordinal         integer not null,
    native_rule_id  text not null,
    native_severity text not null,
    line            integer,
    message         text not null,
    primary key (issue_fp, tool_run_id, ordinal)
  );

  -- One row per tool that has ever detected this issue. Closure is a
  -- conjunction over these rows, which is what makes it independent of the
  -- order two concurrent fan-out tools happen to finish in.
  create table if not exists issue_detectors (
    issue_fp        text not null references issues(fingerprint) on delete cascade,
    tool_id         text not null,
    last_seen_run   text,
    last_absent_run text,
    primary key (issue_fp, tool_id)
  );

  create index if not exists idx_runs_skill on runs(skill_id, started_at);
  create index if not exists idx_stages_run on stages(run_id);
  create index if not exists idx_issues_skill_state on issues(skill_id, state);
  create index if not exists idx_detections_issue on issue_detections(issue_fp);
  create index if not exists idx_detectors_issue on issue_detectors(issue_fp);
  `,
  `
  -- R8.14: extending the rule-class map is an explicit, versioned migration.
  -- This table is what makes "explicit" checkable and "once" enforceable.
  create table if not exists rule_map_migrations (
    version    integer primary key,
    applied_at text not null default (datetime('now')),
    note       text
  );
  `,
]
