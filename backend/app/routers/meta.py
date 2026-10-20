from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..db import database_is_reachable, get_connection
from ..schemas import Health, Source

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=Health)
def health():
    if not database_is_reachable():
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "unavailable"})
    return {"status": "ok", "database": "ok"}


@router.get("/sources", response_model=list[Source],
            summary="Provenance of the imported data (files, checksums, licence, coverage notes)")
def list_sources(connection=Depends(get_connection)):
    return connection.execute("SELECT key, value FROM public.dataset_metadata ORDER BY key").fetchall()
