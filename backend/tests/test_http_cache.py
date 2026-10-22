"""ETag / 304 / Cache-Control on the cached JSON responses (app/cache.py), including through
the CORS and gzip middleware. No database: the version check and connection are stubbed.
Run from backend/: python -m unittest discover tests"""

import asyncio
import contextlib
import gzip
import json
import unittest
from unittest import mock

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app import cache

ORIGIN = "https://french-senate-votes.mohamedkhalil-brik.workers.dev"
DATA = {"items": [{"id": i, "name": f"Sénateur {i}"} for i in range(200)]}  # > gzip minimum size


def make_app():
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origins=[ORIGIN], allow_methods=["GET"],
                       allow_headers=["Content-Type", "If-None-Match"], expose_headers=["ETag"])
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

    @app.get("/data")
    def data(request: Request):
        return cache.cached_json_response(request, ("test-data",), lambda c: DATA)

    @app.get("/broken")
    def broken(request: Request):
        def build(connection):
            raise HTTPException(status_code=404, detail="missing")
        return cache.cached_json_response(request, ("test-broken",), build)

    return app


def call(app, path, headers=None, method="GET"):
    """Run one request through the ASGI app; returns (status, headers dict, body bytes)."""
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
             "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"",
             "root_path": "", "headers": raw_headers, "client": ("test", 1), "server": ("test", 80)}
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    asyncio.run(app(scope, receive, send))
    start = next(m for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    response_headers = {k.decode().lower(): v.decode() for k, v in start["headers"]}
    return start["status"], response_headers, body


class HttpCacheTests(unittest.TestCase):
    def setUp(self):
        cache._entries.clear()
        patches = [
            mock.patch.object(cache, "data_version", return_value=(1, "2026-10-01")),
            mock.patch.object(cache.db, "connection", lambda *a, **k: contextlib.nullcontext(None)),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.app = make_app()

    def test_etag_and_cache_control_on_200(self):
        status, headers, body = call(self.app, "/data")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), DATA)
        self.assertRegex(headers["etag"], r'^"[0-9a-f]{32}"$')
        self.assertEqual(headers["cache-control"], "public, max-age=300, stale-while-revalidate=86400")
        self.assertIn("Accept-Encoding", headers["vary"])

    def test_etag_is_stable_and_follows_the_body(self):
        first = call(self.app, "/data")[1]["etag"]
        cache._entries.clear()  # rebuilt from the same data: same tag
        self.assertEqual(call(self.app, "/data")[1]["etag"], first)
        self.assertEqual(first, cache.body_etag(cache.cached_body(("test-data",), None)[0]))
        self.assertNotEqual(cache.body_etag(b'{"a":1}'), cache.body_etag(b'{"a":2}'))

    def test_if_none_match_gives_304_without_body(self):
        etag = call(self.app, "/data")[1]["etag"]
        status, headers, body = call(self.app, "/data", {"If-None-Match": etag})
        self.assertEqual(status, 304)
        self.assertEqual(body, b"")
        self.assertEqual(headers["etag"], etag)
        self.assertIn("cache-control", headers)
        self.assertNotIn("content-encoding", headers)

    def test_stale_or_other_tag_gives_200(self):
        status, _, body = call(self.app, "/data", {"If-None-Match": '"0123456789abcdef0123456789abcdef"'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), DATA)

    def test_gzip_variant_has_its_own_tag_and_revalidates(self):
        status, headers, body = call(self.app, "/data", {"Accept-Encoding": "gzip, br"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["content-encoding"], "gzip")
        self.assertEqual(json.loads(gzip.decompress(body)), DATA)
        gz_tag = headers["etag"]
        self.assertTrue(gz_tag.endswith('-gz"'))
        identity_tag = call(self.app, "/data")[1]["etag"]
        self.assertNotEqual(gz_tag, identity_tag)
        # Either tag (and weak or listed forms) revalidates.
        for value in (gz_tag, identity_tag, f'W/{gz_tag}', f'"other", {gz_tag}', "*"):
            status, headers, body = call(self.app, "/data", {"Accept-Encoding": "gzip", "If-None-Match": value})
            self.assertEqual(status, 304, value)
            self.assertEqual(body, b"")
            self.assertNotIn("content-encoding", headers)

    def test_cors_headers_on_200_and_304(self):
        status, headers, _ = call(self.app, "/data", {"Origin": ORIGIN})
        self.assertEqual(status, 200)
        self.assertEqual(headers["access-control-allow-origin"], ORIGIN)
        self.assertIn("etag", headers["access-control-expose-headers"].lower())
        status, headers, _ = call(self.app, "/data", {"Origin": ORIGIN, "If-None-Match": headers["etag"]})
        self.assertEqual(status, 304)
        self.assertEqual(headers["access-control-allow-origin"], ORIGIN)

    def test_preflight_allows_if_none_match(self):
        status, headers, _ = call(self.app, "/data", {
            "Origin": ORIGIN, "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "if-none-match",
        }, method="OPTIONS")
        self.assertEqual(status, 200)
        self.assertIn("if-none-match", headers["access-control-allow-headers"].lower())

    def test_errors_carry_no_caching_headers(self):
        status, headers, _ = call(self.app, "/broken", {"If-None-Match": "*"})
        self.assertEqual(status, 404)
        self.assertNotIn("etag", headers)
        self.assertNotIn("cache-control", headers)
        self.assertNotIn(("test-broken",), cache._entries)

    def test_etag_matches_parsing(self):
        tag = '"abc"'
        self.assertTrue(cache.etag_matches('"abc"', tag))
        self.assertTrue(cache.etag_matches('"abc-gz"', tag))
        self.assertTrue(cache.etag_matches(' W/"abc" ', tag))
        self.assertTrue(cache.etag_matches('"x", "abc"', tag))
        self.assertFalse(cache.etag_matches('"abcd"', tag))
        self.assertFalse(cache.etag_matches('', tag))
        self.assertFalse(cache.etag_matches(None, tag))


if __name__ == "__main__":
    unittest.main()
