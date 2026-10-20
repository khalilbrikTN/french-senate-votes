"""Party loyalty: how often each sitting senator votes like the majority of their group.

Definitions (also shown in the frontend caption):
- On each vote, a group's majority position is the strict plurality among its members'
  pour / contre / abstention (non-votants ignored). A tie means the group has no position.
- The group is `individual_votes.group_code`, the senator's group ON THE VOTE DATE, so a
  senator who switched groups is compared with the group they sat in at the time.
- Non-inscrits (AUCUN / NI) are not a group and are excluded, as are the votes where the
  group had fewer than MIN_GROUP_VOTERS expressed positions.
- A senator "follows" when their expressed position equals the group majority, "rebels"
  when it differs; loyalty = follows / (follows + rebels). Votes where the group had no
  majority (ties) count for neither.

individual_votes only holds the votes of the senators sitting at import time and older
sessions are partial, so the figures cover the votes recorded in the database only.
"""

from datetime import datetime, timezone
import json
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Request

from ..cache import cached_body, cached_json_response
from .legacy import MIN_GROUP_VOTERS, app_group_code

router = APIRouter(prefix="/loyalty", tags=["loyalty"])

# Minimum number of counted votes (follows + rebels) for a senator to be ranked.
MIN_RANKED_VOTES = 100
EXCLUDED_GROUPS = ("AUCUN", "NI")
SenatorId = Annotated[str, Path(pattern=r"^[0-9A-Za-z]{1,16}$")]

# Expressed positions of the members of real groups, the per vote x group tallies and
# their strict-plurality majority. Shared by the ranking and the per-senator rebel list.
MAJORITY_CASE = """
    CASE WHEN y > n AND y > a THEN 'pour'
         WHEN n > y AND n > a THEN 'contre'
         WHEN a > y AND a > n THEN 'abstention' END
"""


def loyalty_percent(follows, rebels):
    counted = follows + rebels
    return round(follows / counted * 100, 1) if counted else None


@router.get("")
def loyalty(request: Request):
    # Aggregated from public.individual_votes; cached until the importers commit.
    return cached_json_response(request, ("loyalty",), build_loyalty)


def build_loyalty(connection):
    """Loyalty of every sitting senator and per current group. One statement: the
    expressed rows are read once (MATERIALIZED), tallied per vote x group, then joined back."""
    rows = connection.execute(
        f"""WITH expressed AS MATERIALIZED (
               SELECT session, vote_number, senator_id, position, group_code
               FROM public.individual_votes
               WHERE position IN ('pour', 'contre', 'abstention')
                 AND group_code IS NOT NULL AND group_code <> ALL(%(excluded)s)
           ),
           majorities AS (
               SELECT session, vote_number, group_code, {MAJORITY_CASE} AS majority
               FROM (SELECT session, vote_number, group_code,
                            count(*) FILTER (WHERE position = 'pour') AS y,
                            count(*) FILTER (WHERE position = 'contre') AS n,
                            count(*) FILTER (WHERE position = 'abstention') AS a
                     FROM expressed GROUP BY 1, 2, 3) t
               WHERE y + n + a >= %(min_voters)s
           ),
           per_senator AS (
               SELECT e.senator_id,
                      count(*) FILTER (WHERE e.position = m.majority) AS follows,
                      count(*) FILTER (WHERE e.position <> m.majority) AS rebels,
                      count(*) FILTER (WHERE m.majority IS NULL) AS ties
               FROM expressed e
               JOIN majorities m USING (session, vote_number, group_code)
               GROUP BY 1
           )
           SELECT s.id, s.full_name, s.last_name, s.first_name, s.group_code, s.avatar_url,
                  coalesce(p.follows, 0) AS follows, coalesce(p.rebels, 0) AS rebels,
                  coalesce(p.ties, 0) AS ties
           FROM public.senators s
           LEFT JOIN per_senator p ON p.senator_id = s.id
           WHERE s.senate_status = 'ACTIF'
           ORDER BY s.last_name, s.first_name, s.id""",
        {"excluded": list(EXCLUDED_GROUPS), "min_voters": MIN_GROUP_VOTERS},
    ).fetchall()

    senators, groups = [], {}
    for r in rows:
        group = app_group_code(r["group_code"])
        senators.append({
            "matricule": r["id"], "name": r["full_name"], "group": group,
            "follows": r["follows"], "rebels": r["rebels"], "ties": r["ties"],
            "loyalty": loyalty_percent(r["follows"], r["rebels"]),
            "ranked": r["follows"] + r["rebels"] >= MIN_RANKED_VOTES,
        })
        if group == "NI":
            continue
        g = groups.setdefault(group, {"group": group, "members": 0, "ranked": 0, "follows": 0,
                                      "rebels": 0, "_sum": 0.0})
        g["members"] += 1
        g["follows"] += r["follows"]
        g["rebels"] += r["rebels"]
        if senators[-1]["ranked"]:
            g["ranked"] += 1
            g["_sum"] += senators[-1]["loyalty"]

    group_list = []
    for g in groups.values():
        total = g.pop("_sum")
        # avgLoyalty: mean of the ranked members' loyalty; loyalty: pooled over all votes.
        g["avgLoyalty"] = round(total / g["ranked"], 1) if g["ranked"] else None
        g["loyalty"] = loyalty_percent(g["follows"], g["rebels"])
        group_list.append(g)
    group_list.sort(key=lambda g: (-g["members"], g["group"]))
    return {
        "scope": "sitting_senators",
        "minGroupVoters": MIN_GROUP_VOTERS,
        "minRankedVotes": MIN_RANKED_VOTES,
        "senators": senators,
        "groups": group_list,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@router.get("/{senator_id}/rebels")
def senator_rebels(
    request: Request,
    senator_id: SenatorId,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
):
    return cached_json_response(request, ("loyalty-rebels", senator_id, limit),
                                lambda connection: build_senator_rebels(connection, senator_id, limit))


def build_senator_rebels(connection, senator_id, limit):
    found = connection.execute(
        "SELECT 1 FROM public.senators WHERE id = %s", (senator_id,)).fetchone()
    if found is None:
        raise HTTPException(status_code=404, detail=f"Senator {senator_id} not found")
    # The summary comes from the cached ranking so both views always agree.
    ranking_body, _, _ = cached_body(("loyalty",), build_loyalty)
    ranking = json.loads(ranking_body)
    summary = next((s for s in ranking["senators"] if s["matricule"] == senator_id), None)
    group = next((g for g in ranking["groups"] if summary and g["group"] == summary["group"]), None)

    # Start from this senator's rows (index on senator_id), then tally only their
    # group on those votes (index on session, vote_number).
    rows = connection.execute(
        f"""WITH mine AS MATERIALIZED (
               SELECT session, vote_number, position, group_code, special_status, delegated_by_senator_id
               FROM public.individual_votes
               WHERE senator_id = %(id)s AND position IN ('pour', 'contre', 'abstention')
                 AND group_code IS NOT NULL AND group_code <> ALL(%(excluded)s)
           ),
           tallies AS (
               SELECT m.session, m.vote_number,
                      count(*) FILTER (WHERE iv.position = 'pour') AS y,
                      count(*) FILTER (WHERE iv.position = 'contre') AS n,
                      count(*) FILTER (WHERE iv.position = 'abstention') AS a
               FROM mine m
               JOIN public.individual_votes iv
                 ON iv.session = m.session AND iv.vote_number = m.vote_number
                AND iv.group_code = m.group_code AND iv.position IN ('pour', 'contre', 'abstention')
               GROUP BY 1, 2
           ),
           rebel_votes AS (
               SELECT m.*, t.y, t.n, t.a, {MAJORITY_CASE} AS majority
               FROM mine m JOIN tallies t USING (session, vote_number)
               WHERE t.y + t.n + t.a >= %(min_voters)s
           )
           SELECT r.session, r.vote_number, r.position, r.group_code, r.majority, r.y, r.n, r.a,
                  r.special_status, d.full_name AS delegated_by_name,
                  v.vote_date, v.title, v.result, count(*) OVER () AS total
           FROM rebel_votes r
           JOIN public.votes v ON v.session = r.session AND v.number = r.vote_number
           LEFT JOIN public.senators d ON d.id = r.delegated_by_senator_id
           WHERE r.majority IS NOT NULL AND r.position <> r.majority
           ORDER BY v.vote_date DESC NULLS LAST, r.session DESC, r.vote_number DESC
           LIMIT %(limit)s""",
        {"id": senator_id, "excluded": list(EXCLUDED_GROUPS), "min_voters": MIN_GROUP_VOTERS,
         "limit": limit},
    ).fetchall()
    return {
        "matricule": senator_id,
        "minGroupVoters": MIN_GROUP_VOTERS,
        "minRankedVotes": MIN_RANKED_VOTES,
        "follows": summary["follows"] if summary else 0,
        "rebels": summary["rebels"] if summary else 0,
        "ties": summary["ties"] if summary else 0,
        "loyalty": summary["loyalty"] if summary else None,
        "ranked": summary["ranked"] if summary else False,
        # The senator's current group (null for non-inscrits) and its members' mean loyalty.
        "group": group["group"] if group else None,
        "groupAvgLoyalty": group["avgLoyalty"] if group else None,
        "total": rows[0]["total"] if rows else 0,
        "limit": limit,
        "items": [{
            "scrutinSession": r["session"], "scrutinNumber": r["vote_number"],
            "scrutinTitle": r["title"], "scrutinDate": r["vote_date"].isoformat() if r["vote_date"] else None,
            "scrutinResult": r["result"], "vote": r["position"], "groupPosition": r["majority"],
            "group": app_group_code(r["group_code"]),
            "groupPour": r["y"], "groupContre": r["n"], "groupAbstention": r["a"],
            "specialStatus": r["special_status"], "delegatedBy": r["delegated_by_name"],
        } for r in rows],
    }
