"""FastAPI application: /api/v1 (database API), /api (frontend routes), static frontend."""

from contextlib import asynccontextmanager
import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
import psycopg
from psycopg_pool import PoolTimeout

from . import cache, db
from .config import PROJECT_ROOT, load_settings
from .routers import groups, legacy, meta, senators, votes

settings = load_settings()


def warm_cache():
    """Build the cached frontend lists once at startup so the first visitor is fast."""
    try:
        cache.cached_body(("senateurs", "ACTIF"), lambda c: legacy.build_senateurs(c, "ACTIF"))
        cache.cached_body(("scrutins",), legacy.build_scrutins)
    except Exception:
        pass  # the first request builds them instead


@asynccontextmanager
async def lifespan(app):
    db.open_pool(settings)
    threading.Thread(target=warm_cache, name="warm-cache", daemon=True).start()
    yield
    db.close_pool()


app = FastAPI(
    title="Sénat Votes API",
    version="1.0.0",
    description=(
        "Read-only API over the Sénat Votes database. Data: Sénat (data.senat.fr), "
        "Licence Ouverte 2.0. See /api/v1/sources for files, checksums and coverage notes."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
)
# Compress JSON (and the frontend files) for clients that accept gzip. The cached
# /api/senateurs and /api/scrutins bodies are already gzipped and pass through.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)


@app.exception_handler(psycopg.OperationalError)
@app.exception_handler(PoolTimeout)
async def database_unavailable(request: Request, exc: Exception):
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})


for router in (meta.router, senators.router, groups.router, votes.router):
    app.include_router(router, prefix="/api/v1")
app.include_router(legacy.router, prefix="/api")

# Serve only the frontend's own files, never the rest of the project folder.
FRONTEND_FILES = {"index.html": "text/html", "app.js": "text/javascript", "style.css": "text/css"}
# Revalidate on every load so the browser never runs a stale copy after an edit.
NO_CACHE = {"Cache-Control": "no-cache"}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(PROJECT_ROOT / "index.html", media_type="text/html", headers=NO_CACHE)


@app.get("/{filename}", include_in_schema=False)
def frontend_file(filename: str):
    if filename not in FRONTEND_FILES:
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    return FileResponse(PROJECT_ROOT / filename, media_type=FRONTEND_FILES[filename], headers=NO_CACHE)
