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
