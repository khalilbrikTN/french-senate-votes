"""Shared helpers for the data importers: connection, downloads, Dosleg parsing,
import_runs bookkeeping and dataset_metadata.

The importers are the only code in this project that writes to the database.
They run outside the API (which stays read-only) and are started by hand.
"""

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
import urllib.request
import zipfile

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.config import load_settings

IMPORTERS_DIR = Path(__file__).resolve().parent
CACHE_DIR = IMPORTERS_DIR / ".cache"
USER_AGENT = "senat-votes-importer (+https://data.senat.fr)"
LICENCE = "Licence Ouverte 2.0 (https://data.senat.fr/licence/)"
PRODUCER = "Sénat"
DOSLEG_URL = "https://data.senat.fr/data/dosleg/dosleg.zip"

_C1 = re.compile("[\x80-\x9f]")
_COPY_HEADER = re.compile(r"COPY (?:public\.)?(\w+) \((.*)\) FROM stdin;")
_COPY_ESCAPE = re.compile(r"\\([0-7]{1,3}|x[0-9A-Fa-f]{1,2}|.)")
_COPY_ESCAPES = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v"}
_LINE_BREAKS = re.compile(r"\s*[\r\n]+\s*")


# --------------------------------------------------------------------------- database

def connect():
    """Open a read-write connection (the URL comes from the environment or backend/.env.local)."""
    return psycopg.connect(load_settings().database_url, sslmode="require", row_factory=dict_row)


def start_run(conn):
    """Record a 'running' import run and commit it so it survives a later rollback."""
    run_id = conn.execute(
        "INSERT INTO public.import_runs(status) VALUES ('running') RETURNING id").fetchone()["id"]
    conn.commit()
    return run_id


def finish_run(conn, run_id, senators_count=0, votes_count=0):
    conn.execute(
        """UPDATE public.import_runs SET finished_at = now(), status = 'succeeded',
               senators_count = %s, votes_count = %s, error_summary = NULL WHERE id = %s""",
        (senators_count, votes_count, run_id))


def fail_run(conn, run_id, error):
    """Mark a run as failed. Call after the import transaction was rolled back."""
    conn.execute(
        """UPDATE public.import_runs SET finished_at = now(), status = 'failed',
               error_summary = %s WHERE id = %s""",
        (str(error)[:1000], run_id))
    conn.commit()


def upsert_metadata(conn, key, value):
    conn.execute(
        """INSERT INTO public.dataset_metadata(key, value) VALUES (%s, %s)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
        (key, Jsonb(value)))


def count(conn, sql, params=None):
    return conn.execute(sql, params).fetchone()["n"]


def upsert_via_temp(conn, table, columns, key_columns, rows, order_column=None):
    """Load rows into a temp table with COPY, then upsert them into public.<table>.

    Only rows whose values differ are updated. Returns (inserted, updated,
    order_only), where order_only counts updated rows whose only change is
    `order_column` (their position in the source file). The temp table
    `tmp_<table>` stays available until the transaction ends.
    """
    tmp = f"tmp_{table}"
    cols = ", ".join(columns)
    conn.execute(f"DROP TABLE IF EXISTS {tmp}")
    conn.execute(f"CREATE TEMP TABLE {tmp} ON COMMIT DROP AS "
                 f"SELECT {cols} FROM public.{table} WITH NO DATA")
    with conn.cursor() as cur, cur.copy(f"COPY {tmp} ({cols}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)
    conn.execute(f"ANALYZE {tmp}")
    value_columns = [c for c in columns if c not in key_columns]

    order_only = 0
    if order_column:
        content = [c for c in value_columns if c != order_column]
        join = " AND ".join(f"t.{c} = s.{c}" for c in key_columns)
        order_only = count(conn, f"""
            SELECT count(*) AS n FROM public.{table} t JOIN {tmp} s ON {join}
            WHERE t.{order_column} IS DISTINCT FROM s.{order_column}
              AND (ROW({", ".join(f"t.{c}" for c in content)}))
                  IS NOT DISTINCT FROM (ROW({", ".join(f"s.{c}" for c in content)}))""")

    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in value_columns)
    current = ", ".join(f"t.{c}" for c in value_columns)
    incoming = ", ".join(f"EXCLUDED.{c}" for c in value_columns)
    result = conn.execute(
        f"""WITH changed AS (
                INSERT INTO public.{table} AS t ({cols}) SELECT {cols} FROM {tmp}
                ON CONFLICT ({", ".join(key_columns)}) DO UPDATE SET {updates}
                WHERE (ROW({current})) IS DISTINCT FROM (ROW({incoming}))
                RETURNING (t.xmax = 0) AS inserted)
            SELECT count(*) FILTER (WHERE inserted) AS inserted,
                   count(*) FILTER (WHERE NOT inserted) AS updated FROM changed""").fetchone()
    return result["inserted"], result["updated"], order_only


def describe_updates(updated, order_only):
    if order_only:
        return f"{updated:,} updated ({order_only:,} of them only moved position in the source file)"
    return f"{updated:,} updated"


# --------------------------------------------------------------------------- files

def utc_now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat(timespec="seconds") if dt else None


def _sidecar(path):
    return Path(f"{path}.source.json")


def download(url, dest):
    """Stream `url` to `dest` and return its file info (see file_info).

    The HTTP Last-Modified header is kept in a `<dest>.source.json` sidecar so a
    later run that reuses the cached file still knows the publication date.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    digest, size, started = hashlib.sha256(), 0, time.time()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response, open(partial, "wb") as out:
        header = response.headers.get("Last-Modified")
        while chunk := response.read(1 << 20):
            out.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    os.replace(partial, dest)
    last_modified = None
    if header:
        try:
            last_modified = iso(parsedate_to_datetime(header).astimezone(timezone.utc))
        except (TypeError, ValueError):
            last_modified = None
    info = {"url": url, "sha256": digest.hexdigest(), "bytes": size,
            "last_modified": last_modified, "downloaded_at": iso(utc_now())}
    _sidecar(dest).write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(f"  downloaded {url} ({size / 1e6:.1f} MB in {time.time() - started:.0f}s, "
          f"Last-Modified {last_modified or 'not sent'})")
    return {**info, "path": dest}


def file_info(path, url):
    """Describe a local copy of `url`: path, sha256, bytes and Last-Modified.

    Last-Modified is only known when the file was downloaded by this package
    (sidecar file); otherwise it is None.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Source file not found: {path}")
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    last_modified = None
    sidecar = _sidecar(path)
    if sidecar.is_file():
        saved = json.loads(sidecar.read_text(encoding="utf-8"))
        if saved.get("sha256") == digest.hexdigest():
            last_modified = saved.get("last_modified")
    return {"url": url, "path": path, "sha256": digest.hexdigest(), "bytes": path.stat().st_size,
            "last_modified": last_modified}


def describe_file(info):
    """The part of a file's info stored in dataset_metadata."""
    return {"url": info["url"], "sha256": info["sha256"], "bytes": info["bytes"],
            "last_modified": info["last_modified"]}


# --------------------------------------------------------------------------- Dosleg

def fix_c1(text):
    """Dosleg stores some Windows-1252 punctuation (’ – œ) as C1 control characters."""
    def repl(match):
        try:
            return bytes([ord(match.group())]).decode("cp1252")
        except UnicodeDecodeError:
            return match.group()
    return _C1.sub(repl, text)


def single_line(text):
    """Join the lines of a text with single spaces (titles are shown on one line)."""
    return _LINE_BREAKS.sub(" ", text).strip()


def normalize_newlines(text):
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def _copy_unescape(value):
    """Decode PostgreSQL COPY text-format escapes (\\n, \\r, \\t, \\\\, octal, hex...)."""
    def repl(match):
        token = match.group(1)
        if token[0] in _COPY_ESCAPES:
            return _COPY_ESCAPES[token[0]]
        if token[0] == "x" and len(token) > 1:
            return chr(int(token[1:], 16))
        if token[0] in "01234567":
            return chr(int(token, 8))
        return token
    return _COPY_ESCAPE.sub(repl, value)


def iter_dosleg_rows(zip_path, tables):
    """Yield (table, row dict) for every row of the selected COPY blocks of the Dosleg dump.

    The SQL dump is streamed line by line from the zip; nothing else is kept in memory.
    NULLs (\\N) become None and COPY escapes are decoded (titles and corrections
    contain line breaks written as \\r\\n).
    """
    tables = set(tables)
    with zipfile.ZipFile(zip_path) as archive:
        members = [n for n in archive.namelist() if n.lower().endswith(".sql")]
        if len(members) != 1:
            raise ValueError(f"Expected one .sql file in {zip_path}, found {members}")
        with archive.open(members[0]) as raw:
            current, columns, seen = None, None, set()
            for line in io.TextIOWrapper(raw, encoding="utf-8", newline="\n"):
                if current is None:
                    if line.startswith("COPY "):
                        match = _COPY_HEADER.match(line)
                        if match and match.group(1) in tables:
                            current = match.group(1)
                            columns = [c.strip() for c in match.group(2).split(",")]
                            seen.add(current)
                    continue
                if line.startswith("\\."):
                    current = None
                    continue
                values = line.rstrip("\n").split("\t")
                if len(values) != len(columns):
                    raise ValueError(f"Dosleg table {current}: expected {len(columns)} fields, got {len(values)}")
                yield current, dict(zip(columns, (
                    None if v == "\\N" else _copy_unescape(v) if "\\" in v else v for v in values)))
    missing = tables - seen
    if missing:
        raise ValueError(f"Dosleg dump has no COPY block for: {', '.join(sorted(missing))}")


def fmt(n):
    return f"{n:,}"
