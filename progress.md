# Progress

## Current Status

WorkspaceOS now has a working systems-level collaboration backend showcase. Users can authenticate, create/select workspaces, invite teammates, accept workspace invites, create/share documents and files, enforce resource-level permissions, edit shared documents live with CRDT sync and presence, chat in realtime channels, see workspace presence/typing, receive outbox-backed notifications, inspect an append-only activity feed, create public share links, and use workspace search/autocomplete.

## Completed

- React/Vite frontend and Express backend are in place.
- Better Auth is chosen and implemented for email/password auth.
- PostgreSQL, migrations, and local Docker setup exist.
- Protected workspace shell exists: signup, login, logout, create workspaces, and list workspaces.
- Workspace-scoped document persistence exists with soft archive and version history tables.
- Document APIs exist for list, create, open, update, archive, and read-only version history with workspace membership checks.
- Frontend document UI exists inside the workspace shell: list, editor, save status, archive action, and version history preview.
- MinIO local object storage is wired through Docker Compose and backend env config.
- Workspace-scoped folders, files, and immutable file versions exist in PostgreSQL.
- Drive APIs exist for folder CRUD, file upload intents, upload completion, signed downloads, file rename/move/archive, and file version listing.
- Frontend Files UI exists for folder browsing, upload progress, downloads, replacement versions, rename, move, and archive.
- Workspace invite APIs and UI exist for member listing, pending invites, invite acceptance, and invite revocation.
- Resource-level permission grants exist for documents and files with view/edit/owner levels.
- Document and file reads/writes/downloads now use shared authorization helpers so viewers only see explicitly shared resources.
- In-app notification persistence and UI exist for workspace invites, document shares, and file shares, with unread counts and mark-read actions.
- Redis-backed WebSocket realtime exists for authenticated clients.
- Documents now use Yjs CRDT updates for live collaboration, with durable PostgreSQL snapshots.
- Document room presence, heartbeat cleanup, reconnect handling, and patch rate limiting exist.
- Realtime notification events update online clients when new notifications are created.
- Transactional outbox, background job, and job attempt tables exist, with an in-process worker loop and standalone worker script.
- Notification delivery tracking and notification preferences exist, with realtime delivery performed by background jobs.
- Workspace activity events are append-only and cursor-paginated.
- Workspace chat channels and messages exist with per-channel sequence numbers and client idempotency keys.
- Workspace-wide Redis presence and typing events exist over the authenticated realtime socket.
- Reusable Redis-backed rate limiting exists for document updates, upload intents, invites, channel creation, and chat sends.
- Resumable/block file upload sessions exist with block checksums, block dedupe, MinIO object composition, expiration, and worker cleanup.
- Public document/file share links exist with short tokens, optional passwords, expiration, revocation, anonymous rate limiting, and access counters.
- Workspace search/autocomplete exists across documents, files, chat messages, and popular prior queries.
- Redis-backed hot authorization cache entries exist for workspace membership and resource grants, with explicit and outbox-backed invalidation.
- Structured JSON request/error logs, request IDs, latency metrics, queue metrics, `/metrics`, `/ready`, and authenticated `/api/system/queues` exist.
- Setup and demo flow are documented in `README.md`.

## In Progress / Next

- Run the full two-user systems demo: invite/share/revoke/realtime-edit/chat/mention/activity/public-link/search/rate-limit/metrics.
- Add focused integration/load drills if we want CI to prove retry, duplicate-send, expired-session, and anonymous-abuse scenarios automatically.

## Not Started Yet

- Dedicated external queue service, external search cluster, tracing backend, and deployment automation.
- Folder-level sharing and link preview/media processing.
