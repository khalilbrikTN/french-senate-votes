"""Routes in the shape the frontend (app.js) expects.

app.js reads the field names of the old JSON snapshot. These routes translate the
database into that shape. Lists stay light: a senator's voting history and a vote's
voters are fetched separately when a detail panel opens. New clients should use /api/v1.
"""

from collections import defaultdict
import json
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from .. import themes
from ..cache import cached_json_response
from ..db import database_is_reachable, get_connection
from ..sql import CURRENT_LEADER_JOIN

router = APIRouter(tags=["legacy frontend"])

# The database keeps the Senate's internal group codes; app.js keys its group
# colours and labels by the usual short names.
APP_GROUP_CODES = {"UMP": "LR", "SOC": "SER", "CRC": "CRCE-K", "LREM": "RDPI", "RTLI": "LIRT",
                   "AUCUN": "NI"}
POSITIONS = ("pour", "contre", "abstention", "non_votant")
SenatorId = Annotated[str, Path(pattern=r"^[0-9A-Za-z]{1,16}$")]


def app_group_code(code):
    return APP_GROUP_CODES.get(code, code) if code else "NI"


def iso(value):
    return value.isoformat() if value else None


@router.get("/status")
def status():
    online = database_is_reachable()
    return {"status": "online", "backend": "Regard Sénat API (FastAPI + Supabase)",
            "database": "ok" if online else "unavailable", "hasData": online}


@router.get("/senateurs")
def senateurs(
    request: Request,
    status: Literal["ACTIF", "ANCIEN", "all"] = "ACTIF",
):
    # Cached until the importers commit (see app/cache.py).
    return cached_json_response(request, ("senateurs", status),
                                lambda connection: build_senateurs(connection, status))


def build_senateurs(connection, status):
    status_filter = None if status == "all" else status
    # Vote counts only; the history itself comes from /api/senateurs/{id}/votes.
    # Counted once for all senators with a single GROUP BY (one pass over
    # individual_votes), then joined: cheaper than joining every vote row first.
    senators = connection.execute(
        """SELECT s.id, s.slug, s.first_name, s.last_name, s.full_name, s.title, s.group_code,
                  s.group_full_name, s.department_name, s.department_code, s.commission,
                  s.avatar_url, s.senate_url, s.profession, s.social, s.senate_status,
                  last_group.group_code AS last_group_code, last_group.group_name AS last_group_name,
                  last_group.end_date AS last_group_end, service.first_start, service.last_end,
                  coalesce(c.pour, 0) AS pour, coalesce(c.contre, 0) AS contre,
                  coalesce(c.abstention, 0) AS abstention, coalesce(c.listed, 0) AS listed
           FROM public.senators s
           LEFT JOIN (
               SELECT senator_id,
                      count(*) FILTER (WHERE position = 'pour') AS pour,
                      count(*) FILTER (WHERE position = 'contre') AS contre,
                      count(*) FILTER (WHERE position = 'abstention') AS abstention,
                      count(*) AS listed
               FROM public.individual_votes GROUP BY senator_id
           ) c ON c.senator_id = s.id
           LEFT JOIN LATERAL (
               SELECT m.group_code, m.group_name, m.end_date
               FROM public.senator_group_memberships m WHERE m.senator_id = s.id
               ORDER BY (m.end_date IS NULL) DESC, m.end_date DESC, m.start_date DESC NULLS LAST
               LIMIT 1
           ) last_group ON true
           LEFT JOIN LATERAL (
               SELECT min(start_date) AS first_start, max(end_date) AS last_end
               FROM public.senator_mandates WHERE senator_id = s.id
           ) service ON true
           WHERE (%(status)s::text IS NULL OR s.senate_status = %(status)s)
           ORDER BY s.last_name, s.first_name, s.id""",
        {"status": status_filter},
    ).fetchall()

    result = []
    for s in senators:
        cast = s["pour"] + s["contre"] + s["abstention"]
        dept = s["department_name"]
        if dept and s["department_code"]:
            dept = f"{dept} ({s['department_code']})"
        sitting = s["senate_status"] == "ACTIF"
        # Former senators have no current group: show their last recorded one.
        group_code = s["group_code"] if sitting else s["last_group_code"]
        result.append({
            "matricule": s["id"], "name": s["full_name"], "prenom": s["first_name"],
            "nom": s["last_name"], "slug": s["slug"], "civilite": s["title"],
            "status": s["senate_status"],
            "group": app_group_code(group_code) if group_code or sitting else None,
            "groupFullName": s["group_full_name"] if sitting else s["last_group_name"],
            "lastGroupEndDate": None if sitting or not s["last_group_end"] else s["last_group_end"].isoformat(),
            "serviceStart": s["first_start"].isoformat() if s["first_start"] else None,
            "serviceEnd": None if sitting or not s["last_end"] else s["last_end"].isoformat(),
            "dept": dept, "deptCode": s["department_code"], "commission": s["commission"],
            "avatar": s["avatar_url"], "url": s["senate_url"], "profession": s["profession"],
            "social": s["social"] or {}, "votes": [],
            # participation: share of the public votes held while in office where the
            # senator voted pour, contre or abstention.
            "stats": {"pour": s["pour"], "contre": s["contre"], "abstention": s["abstention"],
                      "total": cast, "listed": s["listed"],
                      "participation": round(cast / s["listed"] * 100) if s["listed"] else 0},
        })
    return result


@router.get("/senateurs/{senator_id}/votes")
def senateur_votes(
    senator_id: SenatorId,
    connection=Depends(get_connection),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    # Existence and count in one round trip.
    found = connection.execute(
        """SELECT EXISTS (SELECT 1 FROM public.senators WHERE id = %(id)s) AS found,
                  (SELECT count(*) FROM public.individual_votes WHERE senator_id = %(id)s) AS n""",
        {"id": senator_id},
    ).fetchone()
    if not found["found"]:
        raise HTTPException(status_code=404, detail=f"Senator {senator_id} not found")
    total = found["n"]
    # Start from this senator's rows (index on senator_id) rather than letting the
    # planner probe individual_votes once per vote.
    rows = connection.execute(
        """WITH mine AS MATERIALIZED (
               SELECT session, vote_number, position, special_status, has_correction,
                      delegated_by_senator_id
               FROM public.individual_votes WHERE senator_id = %s
           )
           SELECT v.session, v.number, v.title, v.vote_date, v.result, iv.position,
                  iv.special_status, iv.has_correction, d.full_name AS delegated_by_name
           FROM mine iv
           JOIN public.votes v ON v.session = iv.session AND v.number = iv.vote_number
           LEFT JOIN public.senators d ON d.id = iv.delegated_by_senator_id
           ORDER BY v.vote_date DESC NULLS LAST, v.session DESC, v.number DESC
           LIMIT %s OFFSET %s""",
        (senator_id, limit, offset),
    ).fetchall()
    return {
        "total": total, "offset": offset, "limit": limit,
        "items": [{
            "scrutinSession": r["session"], "scrutinNumber": r["number"], "scrutinTitle": r["title"],
            "scrutinDate": iso(r["vote_date"]), "scrutinResult": r["result"], "vote": r["position"],
            "specialStatus": r["special_status"], "delegatedBy": r["delegated_by_name"],
            "hasCorrection": r["has_correction"],
        } for r in rows],
    }


@router.get("/scrutins")
def scrutins(request: Request):
    # The full list (app.js filters and sorts it client-side), cached until the
    # importers commit (see app/cache.py).
    return cached_json_response(request, ("scrutins",), build_scrutins)


def build_scrutins(connection):
    votes = connection.execute(
        """SELECT session, number, vote_date, title, result, votes_for, votes_against,
                  abstentions, total, source_url
           FROM public.votes ORDER BY vote_date DESC NULLS LAST, session DESC, number DESC"""
    ).fetchall()

    groups = defaultdict(list)
    for row in connection.execute(
        """SELECT session, vote_number, group_code, group_name, votes_for, votes_against, abstentions
           FROM public.group_vote_totals ORDER BY session, vote_number, source_order"""
    ):
        groups[(row["session"], row["vote_number"])].append({
            "code": app_group_code(row["group_code"]), "name": row["group_name"],
            "pour": row["votes_for"], "contre": row["votes_against"], "abstention": row["abstentions"],
        })

    # Voters are not embedded here; /api/scrutins/{session}/{number} returns them.
    # theme / voteType: automatic, approximate classification of the title (app/themes.py).
    result = []
    for v in votes:
        theme = themes.classify_theme(v["title"])
        vote_type = themes.classify_vote_type(v["title"])
        result.append({
            "number": v["number"], "session": v["session"], "date": iso(v["vote_date"]),
            "title": v["title"], "result": v["result"], "url": v["source_url"],
            "pour": v["votes_for"], "contre": v["votes_against"], "abstention": v["abstentions"],
            "total": v["total"], "groups": groups.get((v["session"], v["number"]), []),
            "senateurs": {p: [] for p in POSITIONS},
            "theme": theme, "themeLabel": themes.THEME_LABELS[theme],
            "voteType": vote_type, "voteTypeLabel": themes.VOTE_TYPE_LABELS[vote_type],
        })
    return result


@router.get("/scrutins/{session}/{number}")
def scrutin_detail(
    session: Annotated[str, Path(max_length=16)],
    number: Annotated[int, Path(ge=1)],
    connection=Depends(get_connection),
):
    vote = connection.execute(
        "SELECT total FROM public.votes WHERE session = %s AND number = %s", (session, number)
    ).fetchone()
    if vote is None:
        raise HTTPException(status_code=404, detail=f"Scrutin {session}/{number} not found")
    voters = {p: [] for p in POSITIONS}
    for r in connection.execute(
        """SELECT iv.senator_id, s.full_name, iv.position, iv.group_code, iv.special_status,
                  iv.has_correction, d.full_name AS delegated_by_name
           FROM public.individual_votes iv
           JOIN public.senators s ON s.id = iv.senator_id
           LEFT JOIN public.senators d ON d.id = iv.delegated_by_senator_id
           WHERE iv.session = %s AND iv.vote_number = %s
           ORDER BY s.last_name, s.first_name""",
        (session, number),
    ):
        voters[r["position"]].append({
            "id": r["senator_id"], "name": r["full_name"], "group": app_group_code(r["group_code"]),
            "specialStatus": r["special_status"], "delegatedBy": r["delegated_by_name"],
            "hasCorrection": r["has_correction"],
        })
    corrections = connection.execute(
        """SELECT text, session_record_url FROM public.vote_corrections
           WHERE session = %s AND vote_number = %s ORDER BY display_order""",
        (session, number),
    ).fetchall()
    return {
        "session": session, "number": number, "senateurs": voters,
        # Individual votes are loaded only for senators sitting at import time.
        "votersScope": "sitting_senators", "listedVoters": sum(len(v) for v in voters.values()),
        "corrections": [{"text": c["text"], "url": c["session_record_url"]} for c in corrections],
    }


@router.get("/stats")
def stats(connection=Depends(get_connection)):
    totals = connection.execute(
        """SELECT count(*) AS total,
                  count(*) FILTER (WHERE result ILIKE 'adopt%') AS adoptes,
                  count(*) FILTER (WHERE result ILIKE 'rejet%') AS rejetes
           FROM public.votes"""
    ).fetchone()
    groups = connection.execute(
        f"""SELECT g.code, g.name, d.color, count(s.id) AS seats,
                   leader.leader_name, leader.leader_senator_id, leader.leader_since
            FROM public.political_groups g
            JOIN public.senators s ON s.group_code = g.code AND s.senate_status = 'ACTIF'
            LEFT JOIN public.political_group_display_settings d ON d.group_code = g.code
            {CURRENT_LEADER_JOIN}
            GROUP BY g.code, g.name, d.color, leader.leader_name, leader.leader_senator_id, leader.leader_since
            ORDER BY seats DESC"""
    ).fetchall()
    # Colours of every group, former ones included (career timelines), by app code.
    # AUCUN and NI share the app code NI; the row whose code is the app code wins.
    group_colors = {}
    for row in connection.execute(
            "SELECT group_code, color FROM public.political_group_display_settings ORDER BY group_code"):
        key = app_group_code(row["group_code"])
        if key not in group_colors or row["group_code"] == key:
            group_colors[key] = row["color"]
    return {
        "totalScrutins": totals["total"], "adoptes": totals["adoptes"], "rejetes": totals["rejetes"],
        "adoptionRate": round(totals["adoptes"] / totals["total"] * 100, 1) if totals["total"] else 0,
        "totalSenateurs": sum(g["seats"] for g in groups),
        "groups": {app_group_code(g["code"]): {
            "name": g["name"], "color": g["color"], "seats": g["seats"],
            # Current president (null when the group has none, e.g. non-inscrits).
            "leader": g["leader_name"], "leaderId": g["leader_senator_id"],
            "leaderSince": iso(g["leader_since"]),
        } for g in groups},
        "groupColors": group_colors,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Supabase (data.senat.fr, Licence Ouverte 2.0)",
    }


# Groups whose behaviour is aggregated from individual votes need at least this many
# members expressing a position (pour/contre/abstention) on a vote for it to count:
# with one or two listed senators a "group majority" or a cohesion score says nothing.
MIN_GROUP_VOTERS = 3


@router.get("/stats/groups")
def stats_groups(request: Request):
    # Aggregated from public.individual_votes; cached until the importers commit.
    return cached_json_response(request, ("stats-groups",), build_group_stats)


def build_group_stats(connection):
    """Per-session coverage, group cohesion and pairwise group agreement.

    individual_votes only holds the votes of the senators sitting at import time, so
    older sessions are partial: `coverage` = individual pour/contre/abstention rows /
    official number of voters (votes.total). Group codes are translated to app codes.
    One statement: the per vote x group tallies are computed once (MATERIALIZED) and
    reused by the cohesion and agreement aggregates.
    """
    row = connection.execute(
        """WITH tallies AS MATERIALIZED (
               SELECT iv.session, iv.vote_number,
                      coalesce(%(aliases)s::jsonb ->> iv.group_code, iv.group_code, 'NI') AS grp,
                      count(*) FILTER (WHERE iv.position = 'pour') AS y,
                      count(*) FILTER (WHERE iv.position = 'contre') AS n,
                      count(*) FILTER (WHERE iv.position = 'abstention') AS a
               FROM public.individual_votes iv
               WHERE iv.position <> 'non_votant'
               GROUP BY 1, 2, 3
           ),
           counted AS MATERIALIZED (
               SELECT session, vote_number, grp, y, n, a, y + n + a AS cast_, greatest(y, n, a) AS top,
                      CASE WHEN y > n AND y > a THEN 'pour'
                           WHEN n > y AND n > a THEN 'contre'
                           WHEN a > y AND a > n THEN 'abstention' END AS majority
               FROM tallies WHERE y + n + a >= %(min_voters)s
           ),
           coverage AS (
               SELECT v.session, count(*) AS votes, sum(v.total) AS official_voters,
                      coalesce(sum(t.cast_), 0) AS individual_cast,
                      count(*) FILTER (WHERE t.cast_ > 0) AS votes_with_individual
               FROM public.votes v
               LEFT JOIN (SELECT session, vote_number, sum(y + n + a) AS cast_
                          FROM tallies GROUP BY 1, 2) t
                      ON t.session = v.session AND t.vote_number = v.number
               GROUP BY v.session
           ),
           cohesion AS (
               SELECT session, grp, count(*) AS votes, avg(cast_) AS avg_voters,
                      avg((top - 0.5 * (cast_ - top)) / cast_) AS ai
               FROM counted GROUP BY 1, 2
           ),
           agreement AS (
               SELECT a.session, a.grp AS g1, b.grp AS g2, count(*) AS votes,
                      count(*) FILTER (WHERE a.majority = b.majority) AS agree
               FROM counted a
               JOIN counted b ON b.session = a.session AND b.vote_number = a.vote_number AND a.grp < b.grp
               WHERE a.majority IS NOT NULL AND b.majority IS NOT NULL
               GROUP BY 1, 2, 3
           )
           SELECT
             (SELECT json_agg(json_build_object(
                  'session', session, 'votes', votes, 'officialVoters', official_voters,
                  'individualCast', individual_cast, 'votesWithIndividual', votes_with_individual,
                  'coverage', CASE WHEN official_voters > 0
                                   THEN round(individual_cast::numeric / official_voters, 4) ELSE 0 END)
                  ORDER BY session) FROM coverage) AS sessions,
             (SELECT json_agg(json_build_object(
                  'session', session, 'group', grp, 'votes', votes,
                  'avgVoters', round(avg_voters, 1), 'agreementIndex', round(ai, 4))
                  ORDER BY session, grp) FROM cohesion) AS cohesion,
             (SELECT json_agg(json_build_object(
                  'session', session, 'groupA', g1, 'groupB', g2, 'votes', votes, 'agree', agree)
                  ORDER BY session, g1, g2) FROM agreement) AS agreement""",
        {"aliases": json.dumps(APP_GROUP_CODES), "min_voters": MIN_GROUP_VOTERS},
    ).fetchone()
    return {
        "scope": "sitting_senators",
        "minGroupVoters": MIN_GROUP_VOTERS,
        "sessions": row["sessions"] or [],
        "cohesion": row["cohesion"] or [],
        "agreement": row["agreement"] or [],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
