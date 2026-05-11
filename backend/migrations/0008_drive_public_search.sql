create type upload_session_status as enum ('pending', 'completed', 'failed', 'expired');

create table file_blocks (
  id uuid primary key default gen_random_uuid(),
  checksum text not null,
  size_bytes integer not null,
  object_key text not null,
  created_by_user_id text not null references "user" ("id") on delete cascade,
  created_at timestamptz not null default now()
);

create unique index file_blocks_checksum_size_idx on file_blocks (checksum, size_bytes);
create unique index file_blocks_object_key_idx on file_blocks (object_key);

create table file_version_blocks (
  id uuid primary key default gen_random_uuid(),
  file_version_id uuid not null references file_versions (id) on delete cascade,
  block_id uuid not null references file_blocks (id) on delete restrict,
  block_index integer not null,
  checksum text not null,
  size_bytes integer not null,
  object_key text not null,
  created_at timestamptz not null default now()
);

create unique index file_version_blocks_version_index_idx on file_version_blocks (file_version_id, block_index);
create index file_version_blocks_block_idx on file_version_blocks (block_id);

create table upload_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  file_id uuid not null references files (id) on delete cascade,
  version_id uuid not null references file_versions (id) on delete cascade,
  created_by_user_id text not null references "user" ("id") on delete cascade,
  file_name text not null,
  mime_type text not null,
  total_size_bytes integer not null,
  block_size_bytes integer not null,
  total_blocks integer not null,
  uploaded_blocks integer not null default 0,
  status upload_session_status not null default 'pending',
  expires_at timestamptz not null,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index upload_sessions_workspace_status_idx on upload_sessions (workspace_id, status, expires_at);
create index upload_sessions_file_idx on upload_sessions (file_id, version_id);

create table upload_session_blocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references upload_sessions (id) on delete cascade,
  block_index integer not null,
  object_key text not null,
  checksum text,
  size_bytes integer,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index upload_session_blocks_session_index_idx on upload_session_blocks (session_id, block_index);
create unique index upload_session_blocks_object_key_idx on upload_session_blocks (object_key);

create table public_share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  resource_type resource_type not null,
  resource_id uuid not null,
  token text not null,
  password_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  created_by_user_id text not null references "user" ("id") on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index public_share_links_token_idx on public_share_links (token);
create index public_share_links_resource_idx on public_share_links (workspace_id, resource_type, resource_id, revoked_at);

create table search_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id text references "user" ("id") on delete set null,
  query text not null,
  normalized_query text not null,
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index search_queries_workspace_query_idx on search_queries (workspace_id, normalized_query, created_at desc);
