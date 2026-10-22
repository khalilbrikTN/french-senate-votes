# Deployment

Where each part of Sénat Votes lives in production, and how to rebuild or update it.

| Part | Host | Source in this repo | URL |
|---|---|---|---|
| Frontend (React, static) | Cloudflare Workers (static assets) | `frontend/` | https://french-senate-votes.mohamedkhalil-brik.workers.dev |
| Backend (FastAPI, read-only API) | Render (Web Service) | `backend/` | https://french-senate-votes.onrender.com |
| Database (PostgreSQL) | Supabase | `supabase/migrations/` (schema), `backend/importers/` (data) | Supabase dashboard, project `<project-ref>` <!-- TODO: fill in --> |
| Code | GitHub | — | https://github.com/khalilbrikTN/french-senate-votes (branch `main`) |

```
Browser ──► Cloudflare Workers (static React build)
   │
   └── /api/... ──► Render (FastAPI) ──► Supabase Postgres (session pooler, read-only sessions)
```

Secrets (the database password and connection string) are stored only in the Render
dashboard and in the local `backend/.env.local`. Never put them in this file, in the
frontend, or in git.

## Frontend: Cloudflare Workers

| Setting | Value |
|---|---|
| Repository / branch | `khalilbrikTN/french-senate-votes`, `main` |
| Root directory | `frontend` |
| Build command | `npm run build` (typecheck, then `vite build`) |
| Output directory | `dist` |
| Build variable | `VITE_API_BASE` = `https://french-senate-votes.onrender.com` (no trailing slash) |
| Node version | 20 or newer (set `NODE_VERSION` if the default is older) |

- `VITE_API_BASE` is read at **build time** (`frontend/src/config.ts`). After changing it, trigger
  a new deployment; editing the variable alone does not change the live site.
- The app uses hash routing (`#scrutins`, `#carte`, …), so no SPA redirect rules are needed.

## Backend: Render

| Setting | Value |
|---|---|
| Service type | Web Service, Python |
| Repository / branch | `khalilbrikTN/french-senate-votes`, `main` |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/api/v1/health` |

Environment variables (Render dashboard → Environment):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** connection string (port 5432). Secret. |
| `CORS_ORIGINS` | `https://french-senate-votes.mohamedkhalil-brik.workers.dev` (exact origin, no trailing slash; add others comma-separated) |
| `DB_POOL_MAX_SIZE` | `4` (default). Keep it small: the Supabase pooler has a limited number of slots shared with local tools. |
| `PYTHON_VERSION` | `3.13.14` (the version used in development) |

- The start command passes Render's `$PORT` directly; `API_HOST`/`API_PORT` are only used by
  `python run.py` locally.
- The API is read-only: each database session is set to `READ ONLY` at connection time.
- Responses are cached in memory and rebuilt when the importers record a new run in
  `import_runs`. The main lists and statistics are warmed at startup, so the first requests after a
  deploy or a wake-up can take a few seconds. Restarting the service clears the cache.
- On Render's free plan the service sleeps when idle; the first visit afterwards waits for it to start.

## Database: Supabase

- **Schema** lives in `supabase/migrations/*.sql`, applied with `backend/migrate.py`
  (recorded in `supabase_migrations.schema_migrations`, compatible with the Supabase CLI).
- **Data** comes from data.senat.fr through `backend/importers/`. They are not run by Render;
  run them from a local machine with `backend/.env.local` set.

Run from `backend/`:

```bash
python migrate.py status              # applied / pending / modified migrations
python migrate.py apply --commit      # apply pending migrations
python -m importers all               # dry run: download, compare, roll back
python -m importers all --commit      # refresh the data
```

The live site picks up new data automatically (cache keyed on `import_runs`); restart the Render
service to see it immediately.

## Releasing a change

1. Merge into `main` on GitHub.
2. Cloudflare and Render rebuild from `main` (if auto-deploy is on for both).
3. Schema changes: run `python migrate.py apply --commit` **before** deploying backend code that
   needs them.
4. Check: `https://french-senate-votes.onrender.com/api/v1/health`, then open the site and the
   Statistiques and Carte pages.

## Local development

```bash
python backend/run.py          # API on http://127.0.0.1:8000 (reads backend/.env.local)
cd frontend && npm run dev     # app on http://localhost:5173, /api proxied to port 8000
```
