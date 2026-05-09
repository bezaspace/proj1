# WorkspaceOS — Phase 0 to Phase 7 Build Guide

## Purpose

This document covers the first build cycle only: from the current React + Vite frontend and Express backend setup through the first usable collaboration product.

The goal is to build a working app first, not a perfect platform. The system should stay flexible enough to change direction as product decisions become clearer, while still being shaped like a future production system.

By the end of Phase 7, the app should support:

* Authenticated users.
* Workspaces.
* Documents.
* File uploads.
* Sharing and permissions.
* Realtime document collaboration.
* Chat and presence.
* Basic notifications.

Infrastructure-heavy work such as full observability, search infrastructure, load balancing, distributed ID generation, and production topology comes later.

---

## Working principle

Build features in the order a real startup product would need them.

Prefer this:

```txt
Useful feature -> clean boundary -> simple implementation -> documented tradeoff -> improve later
```

Avoid this:

```txt
Infrastructure -> abstraction -> framework -> feature eventually
```

The code should be simple, but not careless. Each feature should leave behind enough structure that it can scale later without a rewrite.

---

## Current setup

Preserve the current structure:

```txt
frontend/   React + Vite
backend/    Express + Node.js
infra/      Docker Compose and local services
docs/       Architecture notes, ADRs, runbooks
```

Do not convert to a monorepo unless it becomes useful later. Shared packages can wait.

---

## Phase 0 — Clean local foundation

### Objective

Make the existing frontend and backend reliable to run locally.

### Build

* Normalize frontend folder structure.
* Normalize backend folder structure.
* Add environment config.
* Add backend `/health` endpoint.
* Add frontend API connectivity check.
* Add Docker Compose for PostgreSQL, Redis, and MinIO.
* Add database migration setup.
* Add seed script.
* Add basic backend logger.
* Write initial README.

### Keep flexible

You can choose Prisma or Drizzle. You can choose npm, pnpm, or yarn. The important thing is that the project is easy to run and database changes are migration-based.

### Done when

* Frontend runs locally.
* Backend runs locally.
* Backend connects to PostgreSQL and Redis.
* MinIO is available.
* Frontend can call `/health`.
* A new developer can follow the README and start the project.

---

## Phase 1 — Auth and workspace shell

### Objective

Create the basic product container: a logged-in user inside a workspace.

### Build

* Signup.
* Login.
* Logout.
* Current user endpoint.
* Protected frontend routes.
* Workspace creation.
* Workspace dashboard.
* Workspace membership.
* Basic roles: owner, admin, member, viewer.

### Backend focus

* Password hashing.
* Access token and refresh token flow.
* Auth middleware.
* Role-aware authorization helper.
* Session persistence or refresh-token persistence.
* Basic audit events for important actions.

### Frontend focus

* Auth pages.
* Protected app layout.
* Workspace switcher or current workspace context.
* Clean loading/error states.

### Keep flexible

Do not overbuild enterprise identity. No OAuth yet. No organization billing. No complex invite flow yet. Build the minimum secure version that supports later collaboration.

### Done when

* A user can create an account.
* A user can log in and out.
* A user can create and enter a workspace.
* Protected routes and APIs reject unauthenticated users.

---

## Phase 2 — Documents MVP

### Objective

Add the first core collaboration object: documents.

### Build

* Create document.
* List documents in a workspace.
* Open document.
* Edit document.
* Rename document.
* Delete or archive document.
* Save document content.
* Store basic version history.

### Backend focus

* Document ownership and workspace scoping.
* Permission checks on every document route.
* Document version persistence.
* Transaction boundaries where needed.

### Frontend focus

* Document list.
* Document editor.
* Save status.
* Empty states.
* Basic optimistic updates for rename or creation.

### Keep flexible

The editor can start simple. Plain text, markdown, or a basic rich-text editor is fine. Realtime editing is not required yet. The key is a stable document data model that can support collaboration later.

### Done when

* Users can create, edit, and reopen documents.
* Documents are scoped to a workspace.
* Version history exists at the database level, even if the UI is minimal.

---

## Phase 3 — Files and object storage

### Objective

Add Drive-like file storage using local object storage.

### Build

* Upload file.
* Download file.
* Store file metadata.
* Rename file.
* Delete file.
* Basic folder support if it does not slow progress.
* Signed upload/download URL flow.

### Backend focus

* PostgreSQL stores metadata.
* MinIO stores file bytes.
* API generates signed URLs.
* File size and MIME validation.
* Object key strategy.

### Frontend focus

* File upload UI.
* File list.
* Download action.
* Basic file details.
* Upload progress if easy.

### Keep flexible

Folders are useful, but not worth blocking the phase. Flat file lists are acceptable initially if upload/download is clean.

### Done when

* Files are uploaded to MinIO.
* Metadata is stored in PostgreSQL.
* Users can download uploaded files.
* The API does not permanently proxy all file bytes unnecessarily.

---

## Phase 4 — Sharing and permissions

### Objective

Make collaboration real by allowing controlled access to documents and files.

### Build

* Invite user to workspace.
* Share document with a workspace member.
* Share file with a workspace member.
* Permission levels: view, edit, owner.
* Revoke access.
* Optional public share link with expiration.

### Backend focus

* Central permission-checking logic.
* Resource-level permissions.
* Workspace role inheritance.
* Audit events for share and revoke actions.

### Frontend focus

* Invite modal.
* Share modal.
* Permission selector.
* Shared resources view if easy.

### Keep flexible

Public share links can be postponed if member-to-member sharing takes longer than expected. The important part is that authorization is enforced on the backend, not only hidden in the UI.

### Done when

* User A can share a document or file with User B.
* User B can access only what was shared.
* Permission changes take effect immediately.
* Unauthorized access is rejected by the backend.

---

## Phase 5 — Realtime document collaboration

### Objective

Add the first major system-design feature: live collaborative editing.

### Build

* WebSocket connection.
* Join document room.
* Leave document room.
* Live document updates.
* Presence in document.
* Cursor or active-user indicators.
* Reconnect handling.

### Backend focus

* WebSocket authorization.
* Room membership validation.
* Document-level permission checks.
* Heartbeat or disconnect cleanup.
* Persist final document state safely.

### Frontend focus

* Live editor updates.
* Online collaborators display.
* Connection state indicator.
* Graceful reconnect UX.

### Keep flexible

You can start with simple WebSocket broadcasting before introducing CRDTs. If collaboration conflicts become painful, move to Yjs or Automerge. The first objective is a clear realtime collaboration demo, not a perfect Google Docs engine.

### Done when

* Two browser windows can edit the same document live.
* Each user can see who else is active.
* Reconnect does not obviously break the document.
* Unauthorized users cannot join the document room.

---

## Phase 6 — Chat and presence

### Objective

Add workspace communication and demonstrate realtime state beyond documents.

### Build

* Workspace channels.
* Send message.
* Receive message in realtime.
* Message history.
* Typing indicator.
* Online/offline presence.
* Direct messages only if easy after channels are stable.

### Backend focus

* Message persistence.
* Cursor-based pagination.
* Idempotent message send if practical.
* WebSocket events for chat and presence.
* Presence backed by Redis if available.

### Frontend focus

* Channel list.
* Message list.
* Message composer.
* Typing indicator.
* Presence indicator.

### Keep flexible

Build channels before direct messages. Do not build Slack. Build enough to prove realtime communication, persistence, ordering, and presence.

### Done when

* Users can chat inside a workspace.
* New messages appear without refresh.
* Message history loads after refresh.
* Presence is good enough for demo.

---

## Phase 7 — Notifications MVP

### Objective

Add user-facing async-style behavior before introducing heavier queue infrastructure.

### Build

Trigger notifications for:

* Workspace invitation.
* Document shared.
* File shared.
* Chat mention.
* Document updated by another user.

Deliver notifications through:

* In-app notification center.
* Realtime notification event.
* Development email/log stub if useful.

### Backend focus

* Notification table.
* Read/unread state.
* Notification preferences if simple.
* Deduplication key where useful.
* Delivery status if not too heavy.

### Frontend focus

* Notification bell.
* Notification list.
* Mark as read.
* Realtime toast or badge update.

### Keep flexible

Do not introduce a full notification platform yet. The notification service can be synchronous internally as long as the interface is clean enough to move delivery into background jobs later.

### Done when

* Users receive useful notifications from real collaboration actions.
* Notifications are persisted.
* Users can mark notifications as read.
* Realtime notification updates work while the user is online.

---

## Suggested implementation rhythm

For each phase:

1. Write a short note in `docs/architecture/` explaining the feature.
2. Build the smallest useful backend version.
3. Build the frontend flow.
4. Update README only when developer setup or demo flow changes.
5. Capture tradeoffs in an ADR only when the decision is important.

Do not document every tiny implementation choice. Document choices that affect future architecture.

---

## What to postpone until after Phase 7

* OpenSearch.
* Full background job system.
* Prometheus and Grafana.
* Nginx load balancing.
* Multiple backend instances.
* Distributed rate limiter.
* Snowflake-style ID generator.
* Heavy caching strategy.
* Kubernetes.
* Terraform.
* Multi-region simulation.

These are valuable, but they will be more impressive after the product exists because each one will solve a visible problem.

---

## Phase 7 success definition

The first major milestone is complete when this demo works:

1. Start local services.
2. Open two browser windows as two users.
3. Create a workspace.
4. Invite the second user.
5. Create and share a document.
6. Edit the document live from both windows.
7. Upload and share a file.
8. Send chat messages in realtime.
9. Show presence.
10. Trigger and view notifications.

At that point, the project is no longer a skeleton. It is a real collaboration product with enough surface area to justify the later system-design layers.
