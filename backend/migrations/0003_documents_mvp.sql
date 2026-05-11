create table documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  title text not null,
  content text not null default '',
  created_by_user_id text not null references "user" ("id") on delete cascade,
  updated_by_user_id text not null references "user" ("id") on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_workspace_idx on documents (workspace_id);
create index documents_workspace_updated_idx on documents (workspace_id, updated_at desc);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  version_number integer not null,
  title text not null,
  content text not null,
  editor_user_id text not null references "user" ("id") on delete cascade,
  created_at timestamptz not null default now()
);

create unique index document_versions_document_version_idx on document_versions (document_id, version_number);
create index document_versions_document_idx on document_versions (document_id);
