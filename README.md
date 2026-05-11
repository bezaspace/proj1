# WorkspaceOS

WorkspaceOS is a React + Vite frontend with an Express backend. The current build target is a usable collaboration shell with Better Auth identity, PostgreSQL-backed workspace metadata, CRDT-backed realtime documents, document history, Drive-like file storage on MinIO, member invites, resource sharing, and in-app notifications.

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
- Open People, invite another signed-up user to the workspace, and accept the invite from that user's account.
- Share a document or file with a workspace member using view, edit, or owner access.
- Confirm a viewer only sees resources explicitly shared with them.
- Open Notifications to view invite/share notifications and mark them read.
- Refresh the page and stay authenticated.
- Log out and return to the auth screen.

## Architecture Notes

- Better Auth owns auth users, accounts, sessions, and verification tables.
- The app owns workspaces, memberships, roles, and audit events.
- PostgreSQL stores document/file/folder metadata and immutable version rows.
- MinIO stores file bytes. The API issues signed upload/download URLs so app servers stay stateless and do not proxy object bytes.
- Resource permission grants enforce least-privilege access for workspace viewers while keeping owners/admins able to manage the workspace.
- Yjs powers conflict-free realtime document updates. PostgreSQL stores durable snapshots and version history, while Redis supports realtime pub/sub, presence heartbeats, and patch rate limiting.
- Notifications are persisted synchronously for invites, shares, and document updates, then published over the realtime channel for online clients.
- Chat, public links, heavier queues, and production-grade observability are intentionally deferred to later phases.
