# WorkspaceOS

WorkspaceOS is a React + Vite frontend with an Express backend. The current build target is a usable collaboration shell with Better Auth identity, PostgreSQL-backed workspace metadata, document history, and Drive-like file storage on MinIO.

## Prerequisites

- Node.js 22+
- Docker with Docker Compose

## Local Setup

1. Start local services:

   ```bash
   docker compose up -d postgres minio
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
- Open Files, create folders, upload a file, download it, and upload a replacement version.
- Refresh the page and stay authenticated.
- Log out and return to the auth screen.

## Architecture Notes

- Better Auth owns auth users, accounts, sessions, and verification tables.
- The app owns workspaces, memberships, roles, and audit events.
- PostgreSQL stores document/file/folder metadata and immutable version rows.
- MinIO stores file bytes. The API issues signed upload/download URLs so app servers stay stateless and do not proxy object bytes.
- Redis, realtime, sharing, chat, notifications, and rate limiting are intentionally deferred to later phases.
