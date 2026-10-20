"""Schema migration tool for supabase/migrations/*.sql.

Run from backend/:

    python migrate.py status                 # what is applied, pending, modified
    python migrate.py apply                  # dry run of the pending migrations
    python migrate.py apply --commit         # apply them for real
    python migrate.py verify                 # compare the live schema with the files
    python migrate.py baseline [--commit]    # one-time: record already-applied files

Applied migrations are recorded in supabase_migrations.schema_migrations, the
table the Supabase CLI uses (same columns, same version/name/statements values),
so `supabase migration list` / `supabase db push` can take over later. Extra
bookkeeping (file SHA-256, applied_at, applied_by) lives in
supabase_migrations.applied_files, which the CLI ignores.

This tool is separate from the read-only API in app/; it only reuses
app.config.load_settings() for DATABASE_URL (never printed).
"""

import argparse
import contextlib
import hashlib
from pathlib import Path
import re
import secrets
import sys

import psycopg

from app.config import PROJECT_ROOT, load_settings

MIGRATIONS_DIR = PROJECT_ROOT / "supabase" / "migrations"
FILE_PATTERN = re.compile(r"^([0-9]+)_(.*)\.sql$")  # same pattern as the Supabase CLI
LOCK_TIMEOUT = "10s"

# Matches the Supabase CLI (apps/cli-go/pkg/migration/history.go): the CLI runs
# these same idempotent statements before every push, so they must stay compatible.
CLI_TRACKING_DDL = [
    "CREATE SCHEMA IF NOT EXISTS supabase_migrations",
    "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY)",
    "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[]",
    "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text",
]
# Project-specific bookkeeping. Deliberately no foreign key to schema_migrations:
# the CLI may DELETE or TRUNCATE schema_migrations (`supabase migration repair`),
# and a foreign key would make TRUNCATE fail. schema_migrations is the source of
# truth; a row here without a matching version is ignored.
EXTRA_TRACKING_DDL = [
    """CREATE TABLE IF NOT EXISTS supabase_migrations.applied_files (
        version text PRIMARY KEY,
        filename text NOT NULL,
        sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now(),
        applied_by text NOT NULL CHECK (applied_by IN ('backfill', 'migrate tool'))
    )""",
    "COMMENT ON TABLE supabase_migrations.applied_files IS "
    "'Per-migration file SHA-256 and apply time, written by backend/migrate.py. "
    "applied_by=backfill: recorded by `migrate.py baseline`; applied_at is then the "
    "recording time, not the original apply time.'",
    "REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC, anon, authenticated",
    "REVOKE ALL ON ALL TABLES IN SCHEMA supabase_migrations FROM PUBLIC, anon, authenticated",
]


def out(text=""):
    print(text, flush=True)


# --------------------------------------------------------------------------- files

def split_statements(sql):
    """Split SQL into statements the way the Supabase CLI does (pkg/parser):
    split on ';' outside quotes, comments, dollar quotes and parentheses, strip
    the trailing ';' and surrounding whitespace, keep comments, drop empties.
    (BEGIN ATOMIC function bodies are not supported; none are used here.)"""
    statements, start, i, n = [], 0, 0, len(sql)
    depth = 0
    while i < n:
        c = sql[i]
        if c == "-" and sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and sql.startswith("/*", i):
            level, i = 1, i + 2
            while i < n and level:
                if sql.startswith("/*", i):
                    level, i = level + 1, i + 2
                elif sql.startswith("*/", i):
                    level, i = level - 1, i + 2
                else:
                    i += 1
            continue
        if c in "'\"":
            i += 1
            while i < n:
                if sql[i] == c:
                    if i + 1 < n and sql[i + 1] == c:
                        i += 2
                        continue
                    break
                i += 1
            i += 1
            continue
        if c == "$" and not (i > 0 and (sql[i - 1].isalnum() or sql[i - 1] in "_$")):
            m = re.match(r"\$[A-Za-z_\u0080-￿]*[A-Za-z0-9_\u0080-￿]*\$", sql[i:])
            if m:
                end = sql.find(m.group(0), i + len(m.group(0)))
                i = n if end < 0 else end + len(m.group(0))
                continue
        if c == "\\":
            i += 2
            continue
        if c == "(":
            depth += 1
        elif c == ")" and depth:
            depth -= 1
        elif c == ";" and not depth:
            statements.append(sql[start:i])
            start = i + 1
        i += 1
    statements.append(sql[start:])
    return [s.rstrip(";").strip() for s in statements if s.rstrip(";").strip()]


class MigrationFile:
    def __init__(self, path):
        self.path = path
        m = FILE_PATTERN.match(path.name)
        self.version, self.name = m.group(1), m.group(2)
        raw = path.read_bytes()
        # Hash with LF line endings so a git autocrlf checkout does not look modified.
        self.sha256 = hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()
        self.sql = raw.decode("utf-8-sig").replace("\r\n", "\n")
        self.statements = split_statements(self.sql)


def local_migrations():
    files = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if FILE_PATTERN.match(path.name):
            files.append(MigrationFile(path))
        else:
            out(f"[WARN] ignored (name is not <version>_<name>.sql): {path.name}")
    versions = [f.version for f in files]
    dupes = sorted({v for v in versions if versions.count(v) > 1})
    if dupes:
        raise SystemExit(f"[ERROR] duplicate migration versions: {', '.join(dupes)}")
    return files


# --------------------------------------------------------------------------- database

def connect():
    # autocommit: every conn.transaction() block below is then a real transaction.
    return psycopg.connect(load_settings().database_url, sslmode="require", autocommit=True)


def tracking_exists(conn):
    return conn.execute(
        "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL").fetchone()[0]


def ensure_tracking(conn):
    conn.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
    for stmt in CLI_TRACKING_DDL + EXTRA_TRACKING_DDL:
        conn.execute(stmt)


def read_applied(conn):
    """{version: {name, statements, sha256, applied_at, applied_by}} from the database."""
    if not tracking_exists(conn):
        return None
    applied = {}
    for version, name, statements in conn.execute(
            "SELECT version, coalesce(name, ''), statements FROM supabase_migrations.schema_migrations"):
        applied[version] = {"name": name, "statements": statements, "sha256": None,
                            "applied_at": None, "applied_by": None}
    if conn.execute("SELECT to_regclass('supabase_migrations.applied_files') IS NOT NULL").fetchone()[0]:
        for version, sha, at, by in conn.execute(
                "SELECT version, sha256, applied_at, applied_by FROM supabase_migrations.applied_files"):
            if version in applied:
                applied[version].update(sha256=sha, applied_at=at, applied_by=by)
    return applied


def record(conn, mig, applied_by):
    conn.execute(
        "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES (%s, %s, %s)",
        (mig.version, mig.name, mig.statements))
    conn.execute(
        """INSERT INTO supabase_migrations.applied_files(version, filename, sha256, applied_by)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (version) DO UPDATE SET filename = EXCLUDED.filename,
               sha256 = EXCLUDED.sha256, applied_at = now(), applied_by = EXCLUDED.applied_by""",
        (mig.version, mig.path.name, mig.sha256, applied_by))


def compute_states(files, applied):
    """[(state, version, label, detail)] in version order."""
    applied = applied or {}
    rows = []
    by_version = {f.version: f for f in files}
    for version in sorted(set(by_version) | set(applied)):
        f, a = by_version.get(version), applied.get(version)
        if f and not a:
            rows.append(("pending", version, f.path.name, ""))
        elif a and not f:
            rows.append(("applied-but-file-missing", version, f"{version}_{a['name']}.sql",
                         _applied_detail(a)))
        elif a["sha256"]:
            state = "applied" if a["sha256"] == f.sha256 else "modified-since-applied"
            rows.append((state, version, f.path.name, _applied_detail(a)))
        else:
            # Recorded without a hash (e.g. by the Supabase CLI): compare statements.
            same = list(a["statements"] or []) == f.statements
            rows.append(("applied" if same else "modified-since-applied", version, f.path.name,
                         "recorded without sha256, compared statements"))
    return rows


def _applied_detail(a):
    if a["applied_at"]:
        return f"{a['applied_by']} {a['applied_at']:%Y-%m-%d %H:%M %Z}"
    return ""


def print_states(rows):
    width = max([len(r[0]) for r in rows] + [5])
    for state, _version, label, detail in rows:
        out(f"  {state:<{width}}  {label}" + (f"   ({detail})" if detail else ""))
    counts = {}
    for r in rows:
        counts[r[0]] = counts.get(r[0], 0) + 1
    out("  " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())) if rows else "  (no migrations)")


def public_has_tables(conn):
    return conn.execute(
        "SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))").fetchone()[0]


# --------------------------------------------------------------------------- verification

SNAPSHOT_QUERIES = {
    "table": """
        SELECT c.relname, c.relkind::text, 'rls=' || c.relrowsecurity || ' force_rls=' || c.relforcerowsecurity,
               coalesce(obj_description(c.oid, 'pg_class'), '')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %(s)s AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')""",
    "column": """
        SELECT c.relname || '.' || a.attname, format_type(a.atttypid, a.atttypmod),
               CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END,
               'default=' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '-')
                 || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text,
               coalesce(col_description(c.oid, a.attnum), '')
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE n.nspname = %(s)s AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND a.attnum > 0 AND NOT a.attisdropped
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')""",
    "constraint": """
        SELECT c.relname || '.' || con.conname, con.contype::text, pg_get_constraintdef(con.oid)
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %(s)s""",
    "index": """
        SELECT i.relname, pg_get_indexdef(i.oid)
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = i.relnamespace
        WHERE n.nspname = %(s)s
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = x.indrelid AND d.deptype = 'e')""",
    "policy": """
        SELECT c.relname || '.' || p.polname, p.polcmd::text, p.polpermissive::text,
               coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
               coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %(s)s""",
    "anon/authenticated table grant": """
        SELECT c.relname || ' to ' || CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END,
               string_agg(acl.privilege_type, ', ' ORDER BY acl.privilege_type)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
             LATERAL aclexplode(c.relacl) acl
        WHERE n.nspname = %(s)s AND c.relkind IN ('r', 'p', 'v', 'm')
          AND (acl.grantee = 0 OR acl.grantee::regrole::text IN ('anon', 'authenticated'))
        GROUP BY 1""",
    "trigger": """
        SELECT c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %(s)s AND NOT t.tgisinternal""",
    "function": """
        SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.prokind::text
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = %(s)s
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')""",
    "type": """
        SELECT t.typname, t.typtype::text
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = %(s)s AND t.typtype IN ('e', 'd', 'c')
          AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind <> 'c')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')""",
    "standalone sequence": """
        SELECT c.relname, 'sequence'
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %(s)s AND c.relkind = 'S'
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i', 'e'))""",
}


def snapshot(conn, schema):
    strip = re.compile(r'(?<![\w"])(?:"?public"?|"?' + re.escape(schema) + r'"?)\.')
    snap = {}
    for kind, query in SNAPSHOT_QUERIES.items():
        rows = conn.execute(query, {"s": schema}).fetchall()
        snap[kind] = {r[0]: tuple(strip.sub("", str(v)) for v in r[1:]) for r in rows}
    return snap


def compare(expected, live):
    diffs = []
    for kind in SNAPSHOT_QUERIES:
        exp, got = expected[kind], live[kind]
        for key in sorted(set(exp) | set(got)):
            if key not in got:
                diffs.append(f"missing in live DB   {kind} {key}: {' | '.join(exp[key])}")
            elif key not in exp:
                diffs.append(f"extra in live DB     {kind} {key}: {' | '.join(got[key])}")
            elif exp[key] != got[key]:
                diffs.append(f"different            {kind} {key}:\n"
                             f"      files: {' | '.join(exp[key])}\n"
                             f"      live:  {' | '.join(got[key])}")
    return diffs


def to_scratch(sql, schema):
    """Point a migration at a scratch schema instead of public."""
    sql = re.sub(r'(?<![\w"])public\.', schema + ".", sql)
    return re.sub(r"'public'", f"'{schema}'", sql)


def verify_schema(conn, files):
    """Apply every file, in order, to an empty scratch schema inside a transaction
    that is always rolled back, then compare that schema's catalog with public.
    Nothing in public is touched. Returns the list of differences."""
    schema = "migrate_verify_" + secrets.token_hex(4)
    with conn.transaction(force_rollback=True):
        conn.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
        conn.execute(f"CREATE SCHEMA {schema}")
        for f in files:
            for i, stmt in enumerate(split_statements(to_scratch(f.sql, schema)), 1):
                try:
                    conn.execute(stmt)
                except psycopg.Error as exc:
                    raise SystemExit(f"[ERROR] {f.path.name} statement {i} failed in the scratch "
                                     f"schema: {exc}".rstrip())
        expected = snapshot(conn, schema)
        live = snapshot(conn, "public")
    return compare(expected, live), expected


def run_verify(conn, files):
    out(f"Verifying: applying {len(files)} migration file(s) to a scratch schema "
        "(rolled back) and comparing with public...")
    diffs, expected = verify_schema(conn, files)
    counts = ", ".join(f"{len(v)} {k}" for k, v in expected.items() if v)
    out(f"  Expected from the files: {counts}")
    if diffs:
        out(f"[DIFF] {len(diffs)} difference(s) between the files and the live public schema:")
        for d in diffs:
            out("  " + d)
    else:
        out("[OK] The live public schema matches the cumulative result of the migration files.")
    return diffs


# --------------------------------------------------------------------------- commands

def cmd_status(args):
    files = local_migrations()
    with connect() as conn:
        applied = read_applied(conn)
        if applied is None:
            out("Tracking table supabase_migrations.schema_migrations does not exist yet.")
            if public_has_tables(conn):
                out("The public schema already has tables: run `python migrate.py baseline` once.")
        rows = compute_states(files, applied)
    shown = MIGRATIONS_DIR.relative_to(PROJECT_ROOT) if MIGRATIONS_DIR.is_relative_to(PROJECT_ROOT) else MIGRATIONS_DIR
    out(f"Migrations in {shown}:")
    print_states(rows)
    return 0


def cmd_verify(args):
    with connect() as conn:
        return 1 if run_verify(conn, local_migrations()) else 0


def cmd_baseline(args):
    files = local_migrations()
    if args.up_to:
        files = [f for f in files if f.version <= args.up_to]
    with connect() as conn:
        applied = read_applied(conn) or {}
        todo = [f for f in files if f.version not in applied]
        if not todo:
            out("Nothing to baseline: every migration file is already recorded.")
            return 0
        if applied:
            out("[ERROR] Some migrations are already recorded; baseline is for the first "
                "adoption only. Use `status` / `apply`.")
            return 1
        if run_verify(conn, files) and not args.accept_differences:
            out("[ERROR] Not baselining: fix the differences (or re-run with "
                "--accept-differences after reviewing them).")
            return 1
        out(f"{'Recording' if args.commit else 'Dry run: would record'} {len(todo)} "
            "migration(s) as applied (applied_by=backfill), without running them:")
        with conn.transaction(force_rollback=not args.commit):
            ensure_tracking(conn)
            for f in todo:
                record(conn, f, "backfill")
                out(f"  {f.version}  {f.name}  sha256={f.sha256[:12]}...  {len(f.statements)} statements")
        if args.commit:
            out("[OK] Baseline committed.")
        else:
            out("Dry run: rolled back, nothing written. Re-run with --commit to write.")
    return 0


def cmd_apply(args):
    files = local_migrations()
    with connect() as conn:
        applied = read_applied(conn)
        if not applied and public_has_tables(conn):
            out("[ERROR] Nothing is recorded as applied, but public already has tables. "
                "Run `python migrate.py baseline` first; apply would re-run every migration.")
            return 1
        rows = compute_states(files, applied)
        bad = [r for r in rows if r[0] in ("modified-since-applied", "applied-but-file-missing")]
        if bad:
            out("Applied migrations whose file changed or disappeared:")
            print_states(bad)
            if not args.allow_modified:
                out("[ERROR] Refusing to run. An applied migration must not be edited: put the "
                    "change in a new migration. If the edit is deliberate (comment, no effect on "
                    "an existing database), re-run with --allow-modified.")
                return 1
            out("[WARN] Continuing because of --allow-modified (recorded hashes are not updated).")
        applied_versions = set(applied or {})
        pending = [f for f in files if f.version not in applied_versions]
        if applied_versions and pending and pending[0].version < max(applied_versions):
            out(f"[WARN] {pending[0].path.name} is older than the newest applied migration "
                f"({max(applied_versions)}); it will still be applied, in filename order.")
        if not pending:
            out("No pending migrations.")
            return 0
        mode = "Applying" if args.commit else "Dry run"
        out(f"{mode}: {len(pending)} pending migration(s), in filename order")
        # Commit: one transaction per migration. Dry run: one outer transaction that
        # is rolled back, with a savepoint per migration so each later migration
        # runs on top of the earlier ones, as it would with --commit.
        outer = contextlib.nullcontext() if args.commit else conn.transaction(force_rollback=True)
        with outer:
            for f in pending:
                out(f"- {f.path.name} ({len(f.statements)} statements)")
                try:
                    with conn.transaction():
                        conn.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
                        ensure_tracking(conn)
                        for i, stmt in enumerate(f.statements, 1):
                            try:
                                conn.execute(stmt)
                            except psycopg.Error as exc:
                                code = [ln for ln in stmt.splitlines() if not ln.lstrip().startswith("--")]
                                raise RuntimeError(f"statement {i} failed: {str(exc).strip()}\n"
                                                   f"    statement starts: {(code or [''])[0][:120]}") from exc
                        record(conn, f, "migrate tool")
                except (RuntimeError, psycopg.Error) as exc:
                    out(f"  [FAILED] {exc}")
                    out("  Rolled back. Stopping; later migrations were not run.")
                    return 1
                out("  [OK] committed" if args.commit else "  [OK] ran successfully")
        if not args.commit:
            out("Dry run: everything was rolled back, nothing written. Re-run with --commit to apply.")
    return 0


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="migrate.py", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="list migrations: applied / pending / modified / missing")
    p = sub.add_parser("apply", help="run pending migrations (dry run unless --commit)")
    p.add_argument("--commit", action="store_true", help="really apply (default: dry run)")
    p.add_argument("--allow-modified", action="store_true",
                   help="run even if an applied migration's file was changed or removed")
    sub.add_parser("verify", help="compare the live public schema with the migration files")
    p = sub.add_parser("baseline", help="one-time: record existing migrations as applied after verifying")
    p.add_argument("--commit", action="store_true", help="write the tracking rows (default: dry run)")
    p.add_argument("--up-to", metavar="VERSION", help="only baseline files with version <= VERSION")
    p.add_argument("--accept-differences", action="store_true",
                   help="baseline even if verify reports differences")
    args = parser.parse_args(argv)
    handler = {"status": cmd_status, "apply": cmd_apply, "verify": cmd_verify,
               "baseline": cmd_baseline}[args.command]
    try:
        return handler(args)
    except psycopg.OperationalError as exc:
        out(f"[ERROR] Database connection failed: {type(exc).__name__}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
