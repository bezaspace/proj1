alter type notification_type add value if not exists 'chat_mention';

create type outbox_event_status as enum ('pending', 'processed', 'failed');
create type background_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead');
create type notification_delivery_status as enum ('pending', 'delivered', 'failed', 'skipped');

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  workspace_id uuid references workspaces (id) on delete cascade,
  actor_user_id text references "user" ("id") on delete set null,
  payload text not null default '{}',
  idempotency_key text not null,
  status outbox_event_status not null default 'pending',
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index outbox_events_idempotency_idx on outbox_events (idempotency_key);
create index outbox_events_status_created_idx on outbox_events (status, created_at);
create index outbox_events_workspace_created_idx on outbox_events (workspace_id, created_at desc);

create table background_jobs (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid references outbox_events (id) on delete set null,
  job_type text not null,
  payload text not null default '{}',
  status background_job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index background_jobs_idempotency_idx on background_jobs (idempotency_key);
create index background_jobs_status_run_after_idx on background_jobs (status, run_after);
create index background_jobs_outbox_event_idx on background_jobs (outbox_event_id);

create table job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references background_jobs (id) on delete cascade,
  attempt_number integer not null,
  status background_job_status not null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index job_attempts_job_idx on job_attempts (job_id, attempt_number);

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  actor_user_id text references "user" ("id") on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  summary text not null,
  metadata text not null default '{}',
  created_at timestamptz not null default now()
);

create index activity_events_workspace_created_idx on activity_events (workspace_id, created_at desc, id desc);
create index activity_events_entity_idx on activity_events (workspace_id, entity_type, entity_id);

create table chat_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  created_by_user_id text not null references "user" ("id") on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index chat_channels_workspace_name_active_idx
  on chat_channels (workspace_id, lower(name))
  where archived_at is null;
create index chat_channels_workspace_updated_idx on chat_channels (workspace_id, updated_at desc);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references chat_channels (id) on delete cascade,
  sender_user_id text not null references "user" ("id") on delete cascade,
  client_message_id text not null,
  sequence_number integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  archived_at timestamptz
);

create unique index chat_messages_channel_sequence_idx on chat_messages (channel_id, sequence_number);
create unique index chat_messages_client_id_idx on chat_messages (channel_id, sender_user_id, client_message_id);
create index chat_messages_workspace_created_idx on chat_messages (workspace_id, created_at desc);
create index chat_messages_channel_sequence_desc_idx on chat_messages (channel_id, sequence_number desc);

create table notification_preferences (
  user_id text primary key references "user" ("id") on delete cascade,
  in_app_enabled boolean not null default true,
  realtime_enabled boolean not null default true,
  email_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications (id) on delete cascade,
  channel text not null,
  status notification_delivery_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index notification_deliveries_notification_channel_idx
  on notification_deliveries (notification_id, channel);
create index notification_deliveries_status_idx on notification_deliveries (status, created_at);

insert into chat_channels (workspace_id, name, created_by_user_id)
select id, 'general', created_by_user_id
from workspaces
on conflict do nothing;
