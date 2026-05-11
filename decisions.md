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
