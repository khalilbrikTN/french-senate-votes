# Regard Sénat API

A read-only FastAPI service over the Supabase database described by
`supabase/migrations/`. It never writes: every pooled session runs
`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` when it connects (the Supabase
session pooler ignores the `options` startup parameter, so
`default_transaction_read_only=on` alone did not apply). Connections are in
autocommit mode, which saves the BEGIN/COMMIT round trips on each request. Data is
loaded separately by the importers in
`backend/importers/` (see [Importers](#importers)).

## Run

```powershell
copy backend\.env.example backend\.env.local   # then set DATABASE_URL
npm ci --prefix frontend
npm run build --prefix frontend
start_backend.bat                              # or: python backend\run.py
```

- Site: http://localhost:8000/ (serves the built React app when `frontend/dist` exists)
- Preserved legacy site: http://localhost:8000/legacy
- Interactive API docs: http://localhost:8000/docs

If the React build is absent, `/` continues to serve the legacy page. The server only
serves Vite output from `frontend/dist/assets`; it does not expose other project files.
The React app and API share an origin and use relative `/api` URLs.

`DATABASE_URL` must stay in `backend/.env.local` or the environment; never put it
in frontend code. Optional settings are listed in `.env.example`.

## Layout

```
backend/
  run.py              starts uvicorn with the configured host and port
  migrate.py          schema migrations: status, apply, verify, baseline (writes the schema)
  requirements.txt
  importers/          data loading (writes to the database; not used by the API)
  app/
    main.py           app, CORS, error handling, routers, static frontend files
    config.py         settings from the environment, then backend/.env.local
    db.py             read-only psycopg connection pool
    cache.py          in-process cache of /api/senateurs, /api/scrutins, /api/stats/groups
    schemas.py        response models for /api/v1
    sql.py            shared SQL column lists and search escaping
    routers/
      meta.py         /api/v1/health, /api/v1/sources
      senators.py     /api/v1/senators...
      groups.py       /api/v1/groups...
      votes.py        /api/v1/votes...
      legacy.py       /api/status, /api/senateurs, /api/scrutins, /api/stats, /api/stats/groups
      loyalty.py      /api/loyalty, /api/loyalty/{matricule}/rebels
      compare.py      /api/compare/{matricule_a}/{matricule_b}
```

## Endpoints

| Route | Returns |
|---|---|
| `GET /api/v1/health` | Database reachability (503 when unavailable) |
| `GET /api/v1/sources` | Provenance of imported data: file URLs, SHA-256, licence, coverage notes |
| `GET /api/v1/senators` | Paginated senators. Filters: `status` (`ACTIF` default, `ANCIEN`, `all`), `group` (official code), `department` (code or name), `q` (name search), `limit`, `offset` |
| `GET /api/v1/senators/{matricule}` | Profile, Senate mandates, group membership history, vote counts |
| `GET /api/v1/senators/{matricule}/votes` | Paginated individual votes |
| `GET /api/v1/groups` | Groups with sitting-member counts, display `color` and current `president` (`current_only=false` for historical groups) |
| `GET /api/v1/groups/{code}` | Group with its colour, current president and sitting members |
| `GET /api/v1/votes` | Paginated votes. Filters: `session`, `q` (title search) |
| `GET /api/v1/votes/{session}/{number}` | Vote with group totals and individual votes |

Group codes are the Senate's official codes (`UMP` = Les Républicains, `SOC` = SER,
`CRC` = CRCE-K, `LREM` = RDPI, `RTLI` = Les Indépendants, `UNT`, ...).

### Frontend routes

`/api/status`, `/api/senateurs`, `/api/scrutins` and `/api/stats` return the field
names the current `app.js` reads, and translate official group codes to the short
codes it uses (`UMP` → `LR`, `SOC` → `SER`, `CRC` → `CRCE-K`, `LREM` → `RDPI`,
`RTLI` → `LIRT`, `AUCUN` → `NI`). `/api/senateurs` returns sitting senators only. New clients
should use `/api/v1`.

`/api/stats` → `groups.<code>` has `name`, `seats` (counted live from sitting
senators), `color`, and the current president: `leader`, `leaderId` (matricule),
`leaderSince` (all null when the group has none, e.g. the non-inscrits).
`/api/stats` → `groupColors` maps every app group code that has a colour, former
groups included (`RPR`, `UDR`, `ECO`...), to its colour; app.js uses it for the
career timelines. When the backend is unreachable app.js falls back to the colours
and presidents hardcoded in `POLITICAL_GROUPS` / `HISTORICAL_GROUP_COLORS`.

`/api/compare/{a}/{b}?limit=20` → agreement between two senators, computed in one SQL
statement (self-join of `individual_votes` on the vote) over the votes where both voted
pour, contre or abstention: `shared`, `agree`, `agreementRate` (0..1, null when
`shared` is 0), `breakdown` (`bothPour`, `bothContre`, `bothAbstention`, `opposite`,
`oneAbstained`), `firstDate`/`lastDate`, and the latest `limit` (≤ 100) `disagreements`
(`session`, `number`, `date`, `title`, `result`, `positionA`, `positionB`). 404 for an
unknown matricule, 400 when both are the same. Cached per ordered pair until the importers
commit. Only the sitting senators' individual votes are loaded.

`/api/stats/groups` → group behaviour for the Statistics page, aggregated in one SQL
statement from `individual_votes` (app group codes, `UMP` → `LR`...). Individual votes
exist only for the senators sitting at import time, so older sessions are partial:

- `sessions[]`: `session`, `votes`, `officialVoters` (sum of `votes.total`),
  `individualCast` (individual pour/contre/abstention rows), `votesWithIndividual`,
  `coverage` = `individualCast / officialVoters` (2025: 0.80, 2022: 0.56, 2010: 0.04).
- `cohesion[]`: per `session` × `group`, `agreementIndex` = mean over votes of the
  Hix–Noury–Roland index `(max(P,C,A) − ½·(P+C+A − max)) / (P+C+A)`, with `votes` and
  `avgVoters`.
- `agreement[]`: per `session` × pair (`groupA` < `groupB`), `votes` where both groups had
  a strict majority position (pour, contre or abstention; ties excluded) and `agree` where it
  was the same.
- A group counts on a vote only when at least `minGroupVoters` (3) of its members expressed
  a position. Non-votants are ignored. `scope` is `sitting_senators`.

The frontend hides group figures for sessions under 50 % coverage and flags those under
70 % as partial. Built in about 1 s, ~35 KB (4 KB gzipped).

`/api/loyalty` → party loyalty of every sitting senator (`routers/loyalty.py`). On each vote a
group's majority is the strict plurality of its members' pour/contre/abstention (ties: no
position; groups with fewer than 3 expressed positions and non-inscrits `AUCUN`/`NI` excluded),
using the group recorded on the vote date. `follows` / `rebels` count the senator's expressed
votes equal to / different from that majority, `ties` the votes where the group had none;
`loyalty` = follows / (follows + rebels) in %, `ranked` when that sum ≥ `minRankedVotes` (100).
`groups[]` (current group): `avgLoyalty` (mean of ranked members) and pooled `loyalty`.
One SQL statement, ~2–3 s cold, warmed at startup, ~45 KB (9 KB gzipped).
`/api/loyalty/{matricule}/rebels?limit=` (1–1000, default 100) → the same summary plus the
senator's current `group` and `groupAvgLoyalty`, `total` rebel votes and the latest `limit`
of them with the group's tally (`groupPour`, `groupContre`, `groupAbstention`) and majority
(`groupPosition`). Cached per senator and limit; ~0.1–0.7 s cold.

### Compression and caching

- **Compression**: responses of 1 KB or more are gzipped (`GZipMiddleware`, level 6)
  for clients that send `Accept-Encoding: gzip`. `/api/scrutins` goes from 2.6 MB
  to 240 KB on the wire, `/api/senateurs` from 250 KB to 35 KB.
- **Cache**: `/api/senateurs` (per `status`), `/api/scrutins` and `/api/stats/groups` are built once and
  kept in memory as JSON plus a gzip copy (`app/cache.py`); a hit takes a few
  milliseconds instead of 0.4–0.9 s. They are built in the background at startup.
  The `X-Cache: hit|miss` header shows which happened.
- **Invalidation**: entries are keyed on `max(id)` and `max(finished_at)` of
  `import_runs`. Every committed importer step sets `finished_at` in the same
  transaction as its data, so the next request after a commit rebuilds the cache
  without restarting the server. That key is re-read at most every 10 s
  (`VERSION_CHECK_SECONDS`), so new data shows up within about 10 s. Entries also
  expire after an hour (`MAX_AGE_SECONDS`) in case data is changed outside the
  importers; restart the server to refresh at once. Each server process has its own cache.
- `/api/stats`, `/api/status`, detail routes and `/api/v1` are not cached.

### Group presidents and colours

- **Presidents** are stored in `political_group_periods`, one row per presidency
  (`group_code`, `group_name`, `start_date`, `end_date`, `leader_name`,
  `leader_senator_id`, `source_url`), loaded by the `senators` importer from the
  `ODSEN_HISTOGROUPES` rows whose function is `Président`. The *current* president
  is the period that has started and has no end date or ends today or later.
  Presidencies published without a start date (4 in October 2026: Maurice Blin UC,
  Marcel Lucotte RI, Josy Moinet RDE, Charles Pasqua RPR, all before 2000) are
  skipped and counted; no date is invented. `seats` stays null there: seat counts
  are computed live from `senators`.
- **Colours** are an editorial choice of this site, not Senate data. They live in
  `backend/importers/group_colors.json` (Senate internal codes → `#rrggbb`, former
  groups included) and are loaded into `political_group_display_settings`. To change
  a colour, edit the JSON, then from `backend/`:

  ```powershell
  python -m importers display-settings            # dry run: shows what changes
  python -m importers display-settings --commit   # write
  ```

  Codes not in `political_groups` are skipped with a warning. Keep the fallback
  colours in `app.js` in step if you want the offline view to match.
- Schema: migration `supabase/migrations/20261021000000_group_leaders_and_colors.sql`
  removes the `session` column of `political_group_periods` (presidencies are not
  tied to a session; the migration refuses to run if the table has rows), keys
  periods by `(group_code, start_date)` and adds `leader_senator_id` (FK to
  `senators`). It is idempotent.

## Data notes

- Data: Sénat (data.senat.fr), Licence Ouverte 2.0. Reuse must credit the Sénat and
  show the date of the last update (`/api/v1/sources` → `fetched_at`).
- `senator_mandates` is missing recent terms in the official source; see the
  coverage notes in `/api/v1/sources`.
- Membership `start_date` is `null` when the Senate did not record it.

## Importers

`backend/importers/` refreshes the database from the Sénat open data. It is
separate from `app/` and is the only code that writes data to the database (schema
changes go through `migrate.py`, see [Migrations](#migrations)). Run it from
`backend/` (or use `refresh_data.bat` at the project root):

```powershell
cd backend
python -m importers all                 # dry run: download, compare, roll back
python -m importers all --commit        # write the changes
python -m importers votes --dosleg-zip C:\path\dosleg.zip      # use a local file
python -m importers senators --senat-dir C:\path\senat_files   # use local files
```

- **Dry run is the default.** The import runs in a transaction that is rolled
  back; nothing is written. Add `--commit` to write. In a dry run of `all` the
  steps share one transaction, so later steps see the earlier steps' changes.
- With `--commit`, each step is its own transaction and gets an `import_runs` row
  (`running`, then `succeeded` or `failed`). `all` stops at the first failure;
  earlier steps stay committed.
- Without `--dosleg-zip` / `--senat-dir`, files are downloaded into
  `backend/importers/.cache/` (ignored by git). The HTTP `Last-Modified` header is
  saved next to each file and stored as `source_last_modified`; it is unknown (null)
  for files you supply yourself that were not downloaded by the importers.
- Each step prints what the source contains, rows skipped and why, rows new /
  updated / unchanged, and how that compares with the database.
- Every step writes its provenance (URLs, SHA-256, size, dates, coverage notes) to
  `dataset_metadata`, shown by `GET /api/v1/sources`.

| Target | Source | Loads |
|---|---|---|
| `senators` | data.senat.fr `ODSEN_GENERAL`, `ODSEN_ELUSEN`, `ODSEN_HISTOGROUPES` (JSON) and `www.senat.fr/api-senat/senateurs.json` | Upserts `senators` and `political_groups`; replaces the `senator_mandates`, `senator_group_memberships` and `political_group_periods` (group presidents) rows that come from these files. Metadata key `source:data.senat.fr/senateurs` |
| `display-settings` | `backend/importers/group_colors.json` (this project) | Upserts `political_group_display_settings` (group colours). Metadata key `config:group_colors` |
| `votes` | Dosleg dump `dosleg.zip`, table `scr` | Upserts `votes` on (session, number). Metadata key `source:data.senat.fr/dosleg/scr` |
| `individual-votes` | Dosleg tables `votsen`, `stavot`, `corscr` | Upserts `individual_votes` on (session, vote_number, senator_id); replaces `vote_corrections`. Metadata key `source:data.senat.fr/dosleg/votsen` |
| `all` | all of the above | `senators`, then `display-settings`, then `votes`, then `individual-votes` |

Scope and derived fields:

- **Individual votes cover sitting senators only** (`senators.senate_status =
  'ACTIF'` at import time, so run `senators` first). Rows already stored for
  senators who have since left the Senate are kept, so their history stays. Per-vote
  voter lists and group breakdowns are therefore partial. Individual votes whose
  public vote is not in `votes` are skipped and counted.
- `votes.result` is **derived**: `adopté` when pour > contre, otherwise `rejeté`
  (Dosleg publishes no result). `abstentions` = votants (`scrvot`) minus suffrages
  exprimés (`scrsuf`); `total` = votants. `source_url` is built from the session and
  number. Titles have Windows-1252 characters stored as C1 controls repaired.
- `individual_votes.group_code` is **derived**: the senator's group on the vote
  date from `senator_group_memberships` (null unless exactly one group matches).
  `special_status` is the Dosleg `stavot` label (null when none),
  `delegated_by_senator_id` is the senator whose delegated vote this senator cast,
  `has_correction` marks a later *mise au point* (the official position is unchanged).
- `vote_corrections` skips blank texts and corrections for votes not in `votes`.
- Votes and senators are never deleted by the importers; rows missing from a new
  export are reported and kept.

## Migrations

Schema changes live in `supabase/migrations/<version>_<name>.sql` (version = UTC
timestamp `YYYYMMDDHHMMSS`). `backend/migrate.py` records which ones were applied,
when and with what content. Like the importers it is separate from `app/` (it
only reuses `app.config` for `DATABASE_URL`) and it changes only the schema. Run
it from `backend/` (or use `migrate.bat` at the project root, which passes its
arguments through and runs `status` by default):

```powershell
cd backend
python migrate.py status              # applied / pending / modified-since-applied / applied-but-file-missing
python migrate.py apply               # dry run: run the pending migrations, then roll back
python migrate.py apply --commit      # apply them
python migrate.py verify              # compare the live schema with the files (read-only)
```

To add a migration: create `supabase/migrations/<UTC timestamp>_<short_name>.sql`
with a timestamp later than the last file, run `apply` (dry run) and check that it
succeeds, then `apply --commit`.

- **Dry run is the default.** All pending migrations run in one transaction that
  is rolled back, each on top of the previous one, and the tool reports success or
  the failing statement.
- With `--commit`, each migration runs in its own transaction together with its
  tracking rows, in filename order. The run stops at the first failure (that
  migration is rolled back; earlier ones stay applied).
- **Never edit an applied migration**: write a new one. `apply` refuses to run while
  an applied file was modified (SHA-256 differs) or deleted, unless you add
  `--allow-modified` (for a deliberate, harmless edit such as a comment).
- `CREATE INDEX CONCURRENTLY` and other statements that cannot run in a transaction
  are not supported by this tool.
- `verify` applies every file in order to a temporary scratch schema inside a
  transaction that is always rolled back, then compares tables, columns (type,
  nullability, default, identity, comment), constraints, indexes, RLS flags,
  policies, anon/authenticated grants, triggers, functions and types with `public`.
  It never touches `public`.
- `baseline [--commit]` was a one-time step (run on 2026-10-20): after `verify`
  found no difference, it recorded the six migrations that had been applied by hand
  as `applied_by = 'backfill'` without running them. It refuses to run once any
  migration is recorded.

Tracking tables (schema `supabase_migrations`, no access for `anon` /
`authenticated`, not exposed by the Data API):

| Table | Columns |
|---|---|
| `schema_migrations` | `version text PRIMARY KEY`, `statements text[]`, `name text`: the Supabase CLI table, created with the CLI's own statements |
| `applied_files` | `version`, `filename`, `sha256` (of the file with LF line endings), `applied_at`, `applied_by` (`backfill` or `migrate tool`) |

**Supabase CLI compatibility.** `schema_migrations` has exactly the definition and
values the CLI uses (`version` and `name` from the file name, `statements` split
like the CLI does), so `supabase migration list` / `supabase db push` see these
migrations as applied and only push newer files. The CLI ignores `applied_files`;
migrations pushed by the CLI have no `applied_files` row, and `status` then compares
the recorded statements with the file instead of the hash. Use one tool at a time
for a given migration. `supabase migration repair` changes only `schema_migrations`;
an `applied_files` row without a matching version is ignored.
