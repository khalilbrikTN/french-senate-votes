"""In-process cache for the heavy read-only frontend responses.

Data only changes when the importers commit, and every committed step writes an
`import_runs` row (its `finished_at` is set in the same transaction as the data).
Cached bodies are keyed on (max(id), max(finished_at)) of import_runs, so a commit
refreshes them without restarting the server. That version is re-read at most every
VERSION_CHECK_SECONDS; entries also expire after MAX_AGE_SECONDS as a safety net for
changes made outside the importers. Bodies are stored as JSON bytes plus a gzip copy.
"""

from datetime import date, datetime
import gzip
import json
import threading
import time

from fastapi import Request, Response

from . import db

VERSION_CHECK_SECONDS = 10
MAX_AGE_SECONDS = 3600

_entries = {}  # key -> (version, built_at, body, gzipped body)
_build_locks = {}
_locks_guard = threading.Lock()
_version_lock = threading.Lock()
_version = None
_version_checked_at = None


def _json_default(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Not JSON serialisable: {type(value).__name__}")


def data_version():
    """Latest import_runs state, re-read from the database at most every VERSION_CHECK_SECONDS."""
    global _version, _version_checked_at
    with _version_lock:
        now = time.monotonic()
        if _version_checked_at is None or now - _version_checked_at >= VERSION_CHECK_SECONDS:
            with db.connection() as connection:
                row = connection.execute(
                    "SELECT max(id) AS id, max(finished_at) AS finished FROM public.import_runs"
                ).fetchone()
            _version, _version_checked_at = (row["id"], row["finished"]), now
        return _version


def _fresh(entry, version):
    return entry is not None and entry[0] == version and time.monotonic() - entry[1] < MAX_AGE_SECONDS


def cached_body(key, build):
    """(body, gzipped body, hit) for key; build(connection) produces the data on a miss."""
    # Read the version before building, so a body is never tagged newer than its data.
    version = data_version()
    entry = _entries.get(key)
    if _fresh(entry, version):
        return entry[2], entry[3], True
    with _locks_guard:
        lock = _build_locks.setdefault(key, threading.Lock())
    with lock:  # one build per key; concurrent requests wait for it
        entry = _entries.get(key)
        if _fresh(entry, version):
            return entry[2], entry[3], True
        with db.connection() as connection:
            data = build(connection)
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":"),
                          default=_json_default).encode("utf-8")
        entry = (version, time.monotonic(), body, gzip.compress(body, compresslevel=6))
        _entries[key] = entry
        return entry[2], entry[3], False


def cached_json_response(request: Request, key, build):
    body, gzipped, hit = cached_body(key, build)
    headers = {"Vary": "Accept-Encoding", "X-Cache": "hit" if hit else "miss"}
    # Send the stored gzip copy directly; GZipMiddleware leaves responses that
    # already carry a Content-Encoding alone.
    if "gzip" in request.headers.get("accept-encoding", "").lower():
        headers["Content-Encoding"] = "gzip"
        body = gzipped
    return Response(content=body, media_type="application/json", headers=headers)
