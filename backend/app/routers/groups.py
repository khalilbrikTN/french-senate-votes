from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from ..db import get_connection
from ..schemas import Group, GroupDetail
from ..sql import CURRENT_LEADER_JOIN, SENATOR_SUMMARY_COLUMNS

router = APIRouter(prefix="/groups", tags=["groups"])

GROUP_COLUMNS = """
    g.code, g.name, d.color,
    (SELECT count(*) FROM public.senators s
     WHERE s.group_code = g.code AND s.senate_status = 'ACTIF') AS sitting_members,
    leader.leader_name, leader.leader_senator_id, leader.leader_since
"""
GROUP_FROM = f"""
    FROM public.political_groups g
    LEFT JOIN public.political_group_display_settings d ON d.group_code = g.code
    {CURRENT_LEADER_JOIN}
"""


def with_president(row):
    name, senator_id, since = row.pop("leader_name"), row.pop("leader_senator_id"), row.pop("leader_since")
    row["president"] = {"name": name, "senator_id": senator_id, "since": since} if name else None
    return row


@router.get("", response_model=list[Group])
def list_groups(
    connection=Depends(get_connection),
    current_only: Annotated[bool, Query(description="Only groups with sitting senators")] = True,
):
    rows = connection.execute(
        f"""SELECT {GROUP_COLUMNS} {GROUP_FROM}
            ORDER BY sitting_members DESC, g.code"""
    ).fetchall()
    return [with_president(row) for row in rows if row["sitting_members"] > 0 or not current_only]


@router.get("/{code}", response_model=GroupDetail)
def get_group(code: Annotated[str, Path(max_length=32)], connection=Depends(get_connection)):
    group = connection.execute(
        f"""SELECT {GROUP_COLUMNS} {GROUP_FROM}
            WHERE g.code = %s""",
        (code,),
    ).fetchone()
    if group is None:
        raise HTTPException(status_code=404, detail=f"Group {code} not found")
    group = with_president(group)
    group["members"] = connection.execute(
        f"""SELECT {SENATOR_SUMMARY_COLUMNS} FROM public.senators s
            WHERE s.group_code = %s AND s.senate_status = 'ACTIF'
            ORDER BY s.last_name, s.first_name, s.id""",
        (code,),
    ).fetchall()
    return group
