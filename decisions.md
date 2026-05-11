# Decision Log

## 2026-05-08

1. Adopt a feature-first development strategy
- We will build product functionality first and defer infrastructure/tooling complexity until later.

2. Split codebase into two separate apps
- Frontend: `frontend/` (React + Vite)
- Backend: `backend/` (Node.js + Express)

3. Keep documentation concise and centralized
- Do not duplicate guidance across many files initially.
- Use the existing root plan as the single source of project context, and add only concise focused updates going forward.

4. Lean bootstrap only
- Create runnable app shells (dependencies + basic entry points + health route) without infra stack, orchestration, or extra platform services at this stage.

5. Prioritize speed to first feature
- Set up dependencies and app entry structure now so feature implementation can begin immediately.

## 2026-05-09

1. Use Better Auth for authentication
- Better Auth will own identity, password auth, sessions, and auth persistence instead of custom auth code.

2. Keep workspace authorization app-owned
- The app will own workspaces, memberships, roles, and permission checks because those are product concepts.

3. Build a thin Phase 0.5 before continuing Phase 1
- Add only the local foundation needed for auth and workspaces now: PostgreSQL, env config, migrations, and setup docs. Defer Redis and MinIO until their phases.

## 2026-05-10

1. Start Phase 2 with a plain document editor
- Use a simple title plus plain text content editor first. Rich text, markdown preview, autosave, and realtime collaboration can come after the persistence and permission model are proven.

2. Scope documents to workspace membership
- Workspace membership is the permission boundary for the Documents MVP. Viewers can read documents, while members, admins, and owners can create, edit, and archive them.

3. Keep document deletion reversible
- Archive documents with `archived_at` instead of physically deleting rows. This keeps the product safer while sharing, audit, and recovery behavior are still evolving.

4. Persist document versions from the start
- Store a version snapshot on create, update, and archive even before exposing version history in the UI, so later collaboration features have a stable data trail.

5. Build Phase 3 as a Drive-style backend showcase
- Phase 3 should demonstrate senior backend tradeoffs, not only a basic upload form. PostgreSQL owns metadata, MinIO owns file bytes, and the API issues signed URLs so app servers remain stateless.

6. Add folders and file versions during Phase 3
- Folders make the product feel like a real workspace drive. Immutable file version rows are included even though they were optional in the original phase plan because they show reliability, auditability, and revision-history design.

7. Defer Redis, queues, and rate limiting
- Do not add generic infrastructure before the product has enough traffic-shaping needs. Revisit rate limits after sharing, realtime, chat, and notifications make the API surface clearer.

## 2026-05-11

1. Start Phase 4 with workspace invites and resource grants
- Collaboration now begins with explicit workspace invites plus document/file permissions. This gives the backend a real least-privilege surface before adding realtime features.

2. Keep file and document sharing member-scoped
- Public links and folder sharing remain deferred. Phase 4 focuses on sharing individual documents/files with existing workspace members using view, edit, and owner grants.

3. Persist notifications synchronously for now
- Invite/share notifications are written in the same product flow as the triggering action. The table shape keeps delivery queue-ready, but Redis and background workers remain deferred.

4. Treat owner grants as the resource-management boundary
- Resource creators receive owner grants on create. Workspace owners/admins can manage all resources, while resource owners can share, revoke, and archive their own documents/files.

5. Use Yjs for realtime document collaboration
- Phase 5 starts with a real CRDT instead of last-write-wins broadcasting. Yjs gives conflict-free merging, a credible path to offline editing, and a stronger senior-backend portfolio signal.

6. Use Redis for concrete realtime needs
- Redis is now introduced because the app has actual ephemeral-state requirements: WebSocket pub/sub, document room presence, and short-window edit rate limiting.

7. Keep PostgreSQL as the document source of truth
- Realtime updates flow through Yjs and Redis, but durable document content, CRDT snapshots, version history, permissions, audit events, and notifications remain in PostgreSQL.

## 2026-05-11 Systems Showcase Update

1. Reframe the project from MVP to senior backend showcase
- WorkspaceOS should demonstrate system-design concepts directly: durable async work, idempotency, ordered chat, rate limiting, presence, metrics, and append-only feeds.

2. Use transactional outbox before adding an external queue
- PostgreSQL owns outbox events, jobs, and attempts so local development remains simple while preserving a queue-ready boundary.

3. Keep chat ordering local to each channel
- Chat messages use per-channel monotonic sequence numbers instead of a global Snowflake-style ID because ordering only needs to be stable inside a channel.

4. Treat activity as the durable offline catch-up feed
- Activity events are append-only and cursor-paginated, mapping news-feed/system-sync concepts into the current product.

5. Prefer Redis for ephemeral distributed coordination
- Redis backs rate limiting, workspace presence, typing indicators, and pub/sub fanout, while PostgreSQL remains the durable source of truth.

## 2026-05-11 Systems Showcase Wave 2

1. Model Drive sync with resumable sessions before adding a sync client
- File bytes now support block upload, checksum dedupe, object composition, expiration, and cleanup. The product can still use simple signed uploads, but the backend exposes the more scalable storage model.

2. Map URL-shortener concepts to public share links
- Public links use short tokens, optional passwords, expiration, revocation, access counters, and anonymous rate limits instead of exposing raw resource IDs.

3. Keep search Postgres-native until scale demands a new service
- Full-text/prefix search plus query-popularity telemetry is enough for the current product. A dedicated indexer can be introduced later without changing the public API.

4. Cache only hot authorization paths
- Redis caches workspace membership and resource grants because those checks sit on most routes. Write paths invalidate explicitly and enqueue cache-invalidation jobs through the outbox.

5. Prefer production-shaped observability over heavy tooling
- Request IDs, structured JSON logs, latency metrics, queue metrics, upload-session status, and error envelopes are in place. External tracing/log aggregation remains a deployment concern.
