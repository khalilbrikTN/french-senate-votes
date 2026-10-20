from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from ..db import get_connection
from ..schemas import Page, VoteDetail, VoteSummary
from ..sql import VOTE_SUMMARY_COLUMNS, like_pattern

router = APIRouter(prefix="/votes", tags=["votes"])


@router.get("", response_model=Page[VoteSummary])
def list_votes(
    connection=Depends(get_connection),
    session: Annotated[Optional[str], Query(max_length=16, description="Senate session, e.g. 2024")] = None,
    q: Annotated[Optional[str], Query(min_length=2, max_length=200, description="Search in titles")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    params = {"session": session, "q": like_pattern(q) if q else None, "limit": limit, "offset": offset}
    where = """
        WHERE (%(session)s::text IS NULL OR v.session = %(session)s)
          AND (%(q)s::text IS NULL OR v.title ILIKE %(q)s)
    """
    total = connection.execute(f"SELECT count(*) AS n FROM public.votes v {where}", params).fetchone()["n"]
    items = connection.execute(
        f"""SELECT {VOTE_SUMMARY_COLUMNS} FROM public.votes v {where}
            ORDER BY v.vote_date DESC NULLS LAST, v.session DESC, v.number DESC
            LIMIT %(limit)s OFFSET %(offset)s""",
        params,
    ).fetchall()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{session}/{number}", response_model=VoteDetail)
def get_vote(
    session: Annotated[str, Path(max_length=16)],
    number: Annotated[int, Path(ge=1)],
    connection=Depends(get_connection),
):
    vote = connection.execute(
        f"SELECT {VOTE_SUMMARY_COLUMNS} FROM public.votes v WHERE v.session = %s AND v.number = %s",
        (session, number),
    ).fetchone()
    if vote is None:
        raise HTTPException(status_code=404, detail=f"Vote {session}/{number} not found")
    vote["group_totals"] = connection.execute(
        """SELECT group_code, group_name, votes_for, votes_against, abstentions
           FROM public.group_vote_totals WHERE session = %s AND vote_number = %s ORDER BY source_order""",
        (session, number),
    ).fetchall()
    vote["individual_votes"] = connection.execute(
        """SELECT iv.senator_id, s.full_name AS senator_name, iv.position, iv.group_code,
                  iv.special_status, iv.delegated_by_senator_id, iv.has_correction
           FROM public.individual_votes iv JOIN public.senators s ON s.id = iv.senator_id
           WHERE iv.session = %s AND iv.vote_number = %s
           ORDER BY iv.position, s.last_name, s.first_name""",
        (session, number),
    ).fetchall()
    vote["corrections"] = connection.execute(
        """SELECT display_order, text, session_record_url FROM public.vote_corrections
           WHERE session = %s AND vote_number = %s ORDER BY display_order""",
        (session, number),
    ).fetchall()
    return vote
