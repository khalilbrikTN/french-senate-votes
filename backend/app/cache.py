"""In-process cache for the heavy read-only frontend responses.

Data only changes when the importers commit, and every committed step writes an
`import_runs` row (its `finished_at` is set in the same transaction as the data).
Cached bodies are keyed on (max(id), max(finished_at)) of import_runs, so a commit
refreshes them without restarting the server. That version is re-read at most every
VERSION_CHECK_SECONDS; entries also expire after MAX_AGE_SECONDS as a safety net for
changes made outside the importers. Bodies are stored as JSON bytes plus a gzip copy.

Responses also carry HTTP caching headers: a strong ETag (a hash of the JSON body, so it
only changes when the data does) and a Cache-Control letting browsers reuse a body for a
few minutes and revalidate it afterwards; a matching If-None-Match gets 304 Not Modified.
"""

from datetime import date, datetime
import gzip
import hashlib
import json
import threading
import time

from fastapi import Request, Response

from . import db

VERSION_CHECK_SECONDS = 10
MAX_AGE_SECONDS = 3600
# Data only changes when the importers run: browsers may reuse a body for 5 minutes, then
# revalidate it (a cheap 304 when unchanged) while showing the stale copy for up to a day.
CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400"
GZIP_ETAG_SUFFIX = "-gz"

_entries = {}  # key -> (version, built_at, body, gzipped body, etag)
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


def body_etag(body):
    """Strong ETag (quoted) of the identity JSON body."""
    return '"' + hashlib.sha256(body).hexdigest()[:32] + '"'


def _cached_entry(key, build):
    """(body, gzipped body, hit, etag) for key; build(connection) produces the data on a miss."""
    # Read the version before building, so a body is never tagged newer than its data.
    version = data_version()
    entry = _entries.get(key)
    if _fresh(entry, version):
        return entry[2], entry[3], True, entry[4]
    with _locks_guard:
        lock = _build_locks.setdefault(key, threading.Lock())
    with lock:  # one build per key; concurrent requests wait for it
        entry = _entries.get(key)
        if _fresh(entry, version):
            return entry[2], entry[3], True, entry[4]
        with db.connection() as connection:
            data = build(connection)
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":"),
                          default=_json_default).encode("utf-8")
        entry = (version, time.monotonic(), body, gzip.compress(body, compresslevel=6), body_etag(body))
        _entries[key] = entry
        return entry[2], entry[3], False, entry[4]


def cached_body(key, build):
    """(body, gzipped body, hit) for key; build(connection) produces the data on a miss."""
    body, gzipped, hit, _ = _cached_entry(key, build)
    return body, gzipped, hit


def _opaque_tag(tag):
    """The opaque part of an entity tag, for the weak comparison If-None-Match uses."""
    tag = tag.strip()
    if tag.startswith("W/"):
        tag = tag[2:]
    return tag


def etag_matches(if_none_match, etag):
    """Whether an If-None-Match header value matches etag or its gzip variant."""
    if not if_none_match:
        return False
    variants = {etag, etag[:-1] + GZIP_ETAG_SUFFIX + '"'}
    for candidate in if_none_match.split(","):
        candidate = _opaque_tag(candidate)
        if candidate == "*" or candidate in variants:
            return True
    return False


def json_response(request: Request, body, gzipped, etag, hit=None):
    """200 with the body (gzip copy when accepted), or 304 when If-None-Match matches."""
    use_gzip = "gzip" in request.headers.get("accept-encoding", "").lower()
    # The gzip bytes differ from the identity ones, so a strong ETag must too.
    tag = etag[:-1] + GZIP_ETAG_SUFFIX + '"' if use_gzip else etag
    headers = {"Vary": "Accept-Encoding", "ETag": tag, "Cache-Control": CACHE_CONTROL}
    if hit is not None:
        headers["X-Cache"] = "hit" if hit else "miss"
    if etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    # Send the stored gzip copy directly; GZipMiddleware leaves responses that
    # already carry a Content-Encoding alone.
    if use_gzip:
        headers["Content-Encoding"] = "gzip"
        body = gzipped
    return Response(content=body, media_type="application/json", headers=headers)


def cached_json_response(request: Request, key, build):
    # Errors raised by build propagate before any caching header is set.
    body, gzipped, hit, etag = _cached_entry(key, build)
    return json_response(request, body, gzipped, etag, hit)
