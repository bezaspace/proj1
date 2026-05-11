create type workspace_invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type resource_type as enum ('document', 'file');
create type resource_permission_level as enum ('view', 'edit', 'owner');
create type notification_type as enum ('workspace_invite', 'document_shared', 'file_shared');

create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  email text not null,
  role workspace_role not null default 'viewer',
  status workspace_invite_status not null default 'pending',
  invited_by_user_id text not null references "user" ("id") on delete cascade,
  accepted_by_user_id text references "user" ("id") on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_invites_workspace_status_idx on workspace_invites (workspace_id, status);
create index workspace_invites_email_status_idx on workspace_invites (email, status);
create unique index workspace_invites_pending_email_idx
  on workspace_invites (workspace_id, lower(email))
  where status = 'pending';

create table resource_permissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  resource_type resource_type not null,
  resource_id uuid not null,
  user_id text not null references "user" ("id") on delete cascade,
  level resource_permission_level not null,
  granted_by_user_id text not null references "user" ("id") on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index resource_permissions_resource_user_idx
  on resource_permissions (workspace_id, resource_type, resource_id, user_id);
create index resource_permissions_user_idx on resource_permissions (user_id);
create index resource_permissions_resource_idx
  on resource_permissions (workspace_id, resource_type, resource_id);

insert into resource_permissions (workspace_id, resource_type, resource_id, user_id, level, granted_by_user_id)
select workspace_id, 'document', id, created_by_user_id, 'owner', created_by_user_id
from documents
where archived_at is null
on conflict do nothing;

insert into resource_permissions (workspace_id, resource_type, resource_id, user_id, level, granted_by_user_id)
select workspace_id, 'file', id, created_by_user_id, 'owner', created_by_user_id
from files
where archived_at is null
on conflict do nothing;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id text not null references "user" ("id") on delete cascade,
  actor_user_id text not null references "user" ("id") on delete cascade,
  workspace_id uuid references workspaces (id) on delete cascade,
  type notification_type not null,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  body text not null,
  metadata text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_created_idx on notifications (recipient_user_id, created_at desc);
create index notifications_unread_idx on notifications (recipient_user_id, read_at);
create unique index notifications_dedupe_idx on notifications (dedupe_key);
