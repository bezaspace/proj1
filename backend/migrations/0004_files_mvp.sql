create type file_upload_status as enum ('pending', 'uploaded', 'failed');

create table folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  parent_folder_id uuid references folders (id) on delete set null,
  name text not null,
  created_by_user_id text not null references "user" ("id") on delete cascade,
  updated_by_user_id text not null references "user" ("id") on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index folders_workspace_parent_idx on folders (workspace_id, parent_folder_id);
create index folders_workspace_updated_idx on folders (workspace_id, updated_at desc);
create unique index folders_workspace_parent_name_active_idx
  on folders (workspace_id, coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;

create table files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  folder_id uuid references folders (id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes integer not null default 0,
  checksum text,
  upload_status file_upload_status not null default 'pending',
  latest_version_number integer not null default 0,
  created_by_user_id text not null references "user" ("id") on delete cascade,
  updated_by_user_id text not null references "user" ("id") on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index files_workspace_folder_idx on files (workspace_id, folder_id);
create index files_workspace_updated_idx on files (workspace_id, updated_at desc);
create unique index files_workspace_folder_name_active_idx
  on files (workspace_id, coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;

create table file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files (id) on delete cascade,
  version_number integer not null,
  object_key text not null,
  mime_type text not null,
  size_bytes integer not null,
  checksum text,
  upload_status file_upload_status not null default 'pending',
  created_by_user_id text not null references "user" ("id") on delete cascade,
  created_at timestamptz not null default now()
);

create unique index file_versions_file_version_idx on file_versions (file_id, version_number);
create unique index file_versions_object_key_idx on file_versions (object_key);
create index file_versions_file_idx on file_versions (file_id);
