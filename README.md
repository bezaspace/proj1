# WorkspaceOS

WorkspaceOS is a React + Vite frontend with an Express backend. The current build target is a systems-level collaboration backend showcase with Better Auth identity, PostgreSQL workspace metadata, CRDT realtime documents, Drive-like storage on MinIO, resource sharing, public links, durable activity feeds, Redis-backed presence/chat/cache/rate limiting, transactional outbox jobs, notification delivery tracking, search/autocomplete, and production-shaped observability.

## Prerequisites

- Node.js 22+
- Docker with Docker Compose

## Local Setup

1. Start local services:

   ```bash
   docker compose up -d postgres minio redis
   ```

2. Configure backend env:

   ```bash
   cp backend/.env.example backend/.env
   ```

   Replace `BETTER_AUTH_SECRET` with a random 32+ character value before using anything beyond local development.

3. Install dependencies if needed:

   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

4. Run migrations:

   ```bash
   cd backend
   npm run migrate
   ```

5. Start the apps in two terminals:

   ```bash
   cd backend
   npm run dev
   ```

   The API process also starts a lightweight in-process job worker for local demos. To run the worker as a separate process, use:

   ```bash
   cd backend
   npm run worker
   ```

   ```bash
   cd frontend
   npm run dev
   ```

6. Open `http://localhost:5173`.

## Current Demo Flow

- Sign up with email and password.
- Create a workspace.
- Create documents, save edits, and inspect document version history.
- Open the same document in two browser sessions and edit live with collaborator presence.
- Open Files, create folders, upload a file, download it, and upload a replacement version.
- Use resumable upload sessions for block upload, checksum dedupe, object composition, expiration, and cleanup behavior.
- Open Chat, send ordered realtime channel messages, see typing indicators, and mention a teammate with `@name` or `@email`.
- Open Activity to inspect the append-only workspace event feed.
- Open People, invite another signed-up user to the workspace, and accept the invite from that user's account.
- Share a document or file with a workspace member using view, edit, or owner access.
- Create public document/file links with optional password, expiration, revocation, counters, and anonymous rate limiting.
- Use workspace search/autocomplete across documents, files, chat, and popular queries.
- Confirm a viewer only sees resources explicitly shared with them.
- Open Notifications to view invite/share notifications and mark them read.
- Visit `http://localhost:4000/metrics` for Prometheus-style metrics and `/api/system/queues` for authenticated queue/upload-session status.
- Refresh the page and stay authenticated.
- Log out and return to the auth screen.

## Architecture Notes

- Better Auth owns auth users, accounts, sessions, and verification tables.
- The app owns workspaces, memberships, roles, and audit events.
- PostgreSQL stores document/file/folder metadata and immutable version rows.
- MinIO stores file bytes. The API issues signed upload/download URLs so app servers stay stateless and do not proxy object bytes.
- Resumable uploads use block rows, client checksums, deduplicated block records, and MinIO object composition to model Google Drive-style sync.
- Resource permission grants enforce least-privilege access for workspace viewers while keeping owners/admins able to manage the workspace.
- Yjs powers conflict-free realtime document updates. PostgreSQL stores durable snapshots and version history, while Redis supports realtime pub/sub, presence heartbeats, and patch rate limiting.
- Chat messages use per-channel sequence numbers plus client-provided idempotency keys so retries do not duplicate messages.
- Notifications are persisted with delivery rows and dispatched through transactional outbox jobs.
- Activity events are append-only and cursor-paginated, giving offline clients a durable catch-up feed.
- Redis supports pub/sub, presence heartbeats, typing indicators, reusable rate limiting, and hot authorization cache entries.
- Public links map URL-shortener concepts into the product: short tokens, revocation, expiration, optional password protection, counters, and anonymous abuse limits.
- Search uses Postgres full-text/prefix queries plus query-popularity tracking. The next production step would be a dedicated indexer when dataset size demands it.
