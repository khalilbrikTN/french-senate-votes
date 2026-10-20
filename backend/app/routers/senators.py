from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from ..db import get_connection
from ..schemas import Page, SenatorDetail, SenatorSummary, SenatorVote
from ..sql import SENATOR_SUMMARY_COLUMNS, VOTE_SUMMARY_COLUMNS, like_pattern

router = APIRouter(prefix="/senators", tags=["senators"])

SenatorId = Annotated[str, Path(pattern=r"^[0-9A-Za-z]{1,16}$", description="Official Senate matricule")]


@router.get("", response_model=Page[SenatorSummary])
def list_senators(
    connection=Depends(get_connection),
    status: Literal["ACTIF", "ANCIEN", "all"] = "ACTIF",
    group: Annotated[Optional[str], Query(description="Official group code, e.g. UMP, SOC, UNT")] = None,
    department: Annotated[Optional[str], Query(description="Department code (e.g. 92) or name")] = None,
    q: Annotated[Optional[str], Query(min_length=2, max_length=100, description="Search in names")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    params = {
        "status": None if status == "all" else status,
        "group": group,
        "department": department,
        "q": like_pattern(q) if q else None,
        "limit": limit,
        "offset": offset,
    }
    where = """
        WHERE (%(status)s::text IS NULL OR s.senate_status = %(status)s)
          AND (%(group)s::text IS NULL OR s.group_code = %(group)s)
          AND (%(department)s::text IS NULL OR s.department_code = %(department)s
               OR s.department_name ILIKE %(department)s)
          AND (%(q)s::text IS NULL OR s.full_name ILIKE %(q)s)
    """
    total = connection.execute(f"SELECT count(*) AS n FROM public.senators s {where}", params).fetchone()["n"]
    items = connection.execute(
        f"""SELECT {SENATOR_SUMMARY_COLUMNS} FROM public.senators s {where}
            ORDER BY s.last_name, s.first_name, s.id LIMIT %(limit)s OFFSET %(offset)s""",
        params,
    ).fetchall()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{senator_id}", response_model=SenatorDetail)
def get_senator(senator_id: SenatorId, connection=Depends(get_connection)):
    senator = connection.execute(
        f"""SELECT {SENATOR_SUMMARY_COLUMNS}, s.slug, s.commission, s.profession, s.social
            FROM public.senators s WHERE s.id = %s""",
        (senator_id,),
    ).fetchone()
    if senator is None:
        raise HTTPException(status_code=404, detail=f"Senator {senator_id} not found")

    senator["mandates"] = connection.execute(
        """SELECT start_date, end_date, election_date, department_name, department_code, source_url
           FROM public.senator_mandates WHERE senator_id = %s ORDER BY start_date""",
        (senator_id,),
    ).fetchall()
    senator["group_memberships"] = connection.execute(
        """SELECT group_code, group_name, start_date, end_date, source_url
           FROM public.senator_group_memberships WHERE senator_id = %s
           ORDER BY coalesce(start_date, end_date) NULLS FIRST, end_date NULLS LAST""",
        (senator_id,),
    ).fetchall()
    senator["vote_counts"] = connection.execute(
        """SELECT count(*) FILTER (WHERE position = 'pour') AS pour,
                  count(*) FILTER (WHERE position = 'contre') AS contre,
                  count(*) FILTER (WHERE position = 'abstention') AS abstention,
                  count(*) FILTER (WHERE position = 'non_votant') AS non_votant,
                  count(*) AS total
           FROM public.individual_votes WHERE senator_id = %s""",
        (senator_id,),
    ).fetchone()
    return senator


@router.get("/{senator_id}/votes", response_model=Page[SenatorVote])
def list_senator_votes(
    senator_id: SenatorId,
    connection=Depends(get_connection),
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    if connection.execute("SELECT 1 FROM public.senators WHERE id = %s", (senator_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Senator {senator_id} not found")
    total = connection.execute(
        "SELECT count(*) AS n FROM public.individual_votes WHERE senator_id = %s", (senator_id,)
    ).fetchone()["n"]
    items = connection.execute(
        f"""SELECT {VOTE_SUMMARY_COLUMNS}, iv.position, iv.group_code, iv.special_status,
                   iv.delegated_by_senator_id, iv.has_correction
            FROM public.individual_votes iv
            JOIN public.votes v ON v.session = iv.session AND v.number = iv.vote_number
            WHERE iv.senator_id = %s
            ORDER BY v.vote_date DESC NULLS LAST, v.session DESC, v.number DESC
            LIMIT %s OFFSET %s""",
        (senator_id, limit, offset),
    ).fetchall()
    return {"items": items, "total": total, "limit": limit, "offset": offset}
