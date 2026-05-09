create extension if not exists pgcrypto;

create type workspace_role as enum ('owner', 'admin', 'member', 'viewer');

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by_user_id text not null references "user" ("id") on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  role workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workspace_members_workspace_user_idx on workspace_members (workspace_id, user_id);
create index workspace_members_user_idx on workspace_members (user_id);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id text not null references "user" ("id") on delete cascade,
  action text not null,
  workspace_id uuid references workspaces (id) on delete set null,
  metadata text,
  created_at timestamptz not null default now()
);

create index audit_events_workspace_idx on audit_events (workspace_id);
create index audit_events_actor_idx on audit_events (actor_user_id);
