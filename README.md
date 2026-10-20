# Sénat Votes

A website for exploring public votes (*scrutins publics*) in the French Senate: what was
voted, how each senator voted, and how the political groups are composed.

All data comes from the Senate's open data (data.senat.fr) and is stored in a PostgreSQL
database (Supabase). A small read-only API serves the React frontend; the previous
HTML/JavaScript frontend remains available at `/legacy` during the migration.

## Features

- **Votes**: 4,776 public votes since October 2006, filterable by parliamentary session,
  result and keyword, each with totals, a link to the official page and post-vote
  corrections (*mises au point*).
- **Senators**: the 348 sitting senators and 1,664 former ones, with photo, group,
  department, profession, social links, voting record and a group-membership timeline.
- **Groups**: current composition, presidents and seats, read live from the database.
- **Statistics**: adoption rates, average turnout, closest votes, seat distribution.
- Works on phones and desktop; French interface.

## How it works

```
data.senat.fr ──► backend/importers ──► Supabase PostgreSQL ──► backend/app (read-only API) ──► frontend/dist (React)
```

| Part | What it does |
|---|---|
| `frontend/src/` | React + TypeScript frontend. Build output is served by FastAPI at `/`. |
| `index.html`, `app.js`, `style.css` | Preserved legacy frontend. Served by FastAPI at `/legacy`. |
| `backend/app/` | FastAPI API and frontend server. Read-only database sessions, gzip, in-memory cache refreshed after each import. Docs at `/docs`. |
| `backend/importers/` | Downloads the Senate's files and loads them into the database. Dry run by default. |
| `backend/migrate.py` | Applies and tracks schema migrations (Supabase CLI–compatible history table). |
| `supabase/migrations/` | Database schema, one SQL file per change. |

Details for each part are in [backend/README.md](backend/README.md).

## Getting started

Requirements: Python 3 (developed and tested with 3.13), Node.js/npm, and a PostgreSQL
database (a free Supabase project works; use its *Session pooler* connection string).

1. **Configure the database connection.** Copy `backend/.env.example` to
   `backend/.env.local` and set `DATABASE_URL`. This file is ignored by git; never commit it.
2. **Install dependencies.**
   ```powershell
   python -m pip install -r backend/requirements.txt
   npm ci --prefix frontend
   npm run build --prefix frontend
   ```
3. **Create the schema** (from `backend/`):
   ```powershell
   python migrate.py status
   python migrate.py apply            # dry run
   python migrate.py apply --commit
   ```
4. **Load the data** (downloads about 20 MB from data.senat.fr):
   ```powershell
   python -m importers all            # dry run: shows what would change
   python -m importers all --commit
   ```
5. **Run the site**, then open http://localhost:8000/ (React) or
   http://localhost:8000/legacy (the preserved frontend):
   ```powershell
   python run.py
   ```

On Windows, `start_backend.bat` installs backend dependencies, builds the React frontend,
and starts FastAPI. Re-run `refresh_data.bat --commit` whenever you want the latest votes
from the Senate.

For live frontend development, start FastAPI as above, then in another terminal run
`cd frontend; npm run dev -- --host 0.0.0.0 --port 5002` and open the Vite URL. Vite
proxies `/api` requests to FastAPI on port 8000. The production frontend is served by the
same FastAPI origin as its API.

Run the React regression suite from the project root with `npm test --prefix frontend`.
`npm run build --prefix frontend` also runs the TypeScript check before producing the build.

## Data and its limits

- Source: Sénat — [data.senat.fr](https://data.senat.fr/) (senator files `ODSEN_*` and the
  `dosleg` database dump) and senat.fr. Licence: [Licence Ouverte 2.0](https://data.senat.fr/licence/).
  Reuse must credit the Sénat and give the date of the last update; `GET /api/v1/sources`
  lists every imported file with its checksum and date.
- **Results are derived**: the Senate's export has no result field, so a vote is shown as
  adopted when *pour* > *contre* (ties are rejected).
- **Individual votes are loaded for sitting senators only**, so per-vote voter lists are
  partial and per-group breakdowns are not shown. Senators' own voting records are complete.
- The Senate's term file currently has no entry for sitting senators' current terms, some
  older group memberships have no start date, and group names are the groups' current names.
- Group colours follow the Senate's own seating chart (lightened where needed for the dark
  theme); they are set in `backend/importers/group_colors.json`.

## Project status

A personal project, run locally. The React frontend uses same-origin `/api` requests.
The legacy frontend remains available at `/legacy` and retains its existing API behavior.
