"""FastAPI application: /api/v1 (database API), /api (frontend routes), static frontend."""

from contextlib import asynccontextmanager
import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
import psycopg
from psycopg_pool import PoolTimeout

from . import cache, db
from .config import PROJECT_ROOT, load_settings
from .routers import groups, legacy, meta, senators, votes
from .routers import compare
from .routers import loyalty
from .routers import themes as theme_routes

settings = load_settings()


def warm_cache():
    """Build the cached frontend lists once at startup so the first visitor is fast."""
    try:
        cache.cached_body(("senateurs", "ACTIF"), lambda c: legacy.build_senateurs(c, "ACTIF"))
        cache.cached_body(("scrutins",), legacy.build_scrutins)
        cache.cached_body(("stats-groups",), legacy.build_group_stats)
        cache.cached_body(("loyalty",), loyalty.build_loyalty)
        cache.cached_body(("stats-themes",), theme_routes.build_theme_stats)
    except Exception:
        pass  # the first request builds them instead


@asynccontextmanager
async def lifespan(app):
    db.open_pool(settings)
    threading.Thread(target=warm_cache, name="warm-cache", daemon=True).start()
    yield
    db.close_pool()


app = FastAPI(
    title="Regard Sénat API",
    version="1.0.0",
    description=(
        "Read-only API over the Regard Sénat database. Data: Sénat (data.senat.fr), "
        "Licence Ouverte 2.0. See /api/v1/sources for files, checksums and coverage notes."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET"],
    # The browser cache revalidates cross-origin responses with If-None-Match on its own
    # (no preflight needed). Allowing/exposing the headers also lets page code do it.
    allow_headers=["Content-Type", "If-None-Match"],
    expose_headers=["ETag"],
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
app.include_router(compare.router, prefix="/api")
app.include_router(loyalty.router, prefix="/api")
app.include_router(theme_routes.router, prefix="/api")

# The React build is generated with `npm run build` in frontend/. Mount only its
# Vite output directory; never expose the rest of the project folder.
REACT_DIST = PROJECT_ROOT / "frontend" / "dist"
REACT_INDEX = REACT_DIST / "index.html"
REACT_ASSETS = REACT_DIST / "assets"
LEGACY_INDEX = PROJECT_ROOT / "index.html"
if REACT_ASSETS.is_dir():
    app.mount("/assets", StaticFiles(directory=REACT_ASSETS), name="react-assets")

# Keep legacy files available throughout the migration. Revalidate HTML and source
# assets on each load so the browser does not keep an old copy after an edit.
FRONTEND_FILES = {"app.js": "text/javascript", "style.css": "text/css"}
NO_CACHE = {"Cache-Control": "no-cache"}
# Files Vite copies from frontend/public to the root of the build (icons, share image).
REACT_ROOT_FILES = {
    "favicon.svg": "image/svg+xml",
    "apple-touch-icon.png": "image/png",
    "og-image.png": "image/png",
}


@app.get("/", include_in_schema=False)
def index():
    # A checkout without a built frontend continues to serve the working legacy UI.
    page = REACT_INDEX if REACT_INDEX.is_file() else LEGACY_INDEX
    return FileResponse(page, media_type="text/html", headers=NO_CACHE)


@app.get("/legacy", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def legacy_index():
    return FileResponse(LEGACY_INDEX, media_type="text/html", headers=NO_CACHE)


@app.get("/{filename}", include_in_schema=False)
def frontend_file(filename: str):
    if filename in REACT_ROOT_FILES and (REACT_DIST / filename).is_file():
        return FileResponse(REACT_DIST / filename, media_type=REACT_ROOT_FILES[filename],
                            headers={"Cache-Control": "public, max-age=86400"})
    if filename not in FRONTEND_FILES:
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    if filename == "app.js":
        # The preserved source targets localhost:8000. Serve it with a same-origin
        # API base so /legacy also works when this server is reached by LAN hostname.
        source = (PROJECT_ROOT / filename).read_text(encoding="utf-8")
        source = source.replace("API_BASE: 'http://localhost:8000'", "API_BASE: ''", 1)
        return Response(source, media_type=FRONTEND_FILES[filename], headers=NO_CACHE)
    return FileResponse(PROJECT_ROOT / filename, media_type=FRONTEND_FILES[filename], headers=NO_CACHE)
