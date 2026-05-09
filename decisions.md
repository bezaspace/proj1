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
