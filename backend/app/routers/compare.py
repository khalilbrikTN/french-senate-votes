"""Compare the individual votes of two senators (/api/compare/{a}/{b}).

Only the votes of the senators sitting today are loaded in individual_votes (older
sessions are partial), so a comparison covers the votes both senators cast while
both were in office and present in the data.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Request

from ..cache import cached_json_response

router = APIRouter(tags=["legacy frontend"])

SenatorId = Annotated[str, Path(pattern=r"^[0-9A-Za-z]{1,16}$", description="Official Senate matricule")]

# One round trip: existence of both senators, the counts over the votes where both
# expressed pour/contre/abstention (self-join of individual_votes on the vote), and
# the latest disagreements. Each side starts from its own rows (index on senator_id).
COMPARE_SQL = """
WITH a AS MATERIALIZED (
    SELECT session, vote_number, position FROM public.individual_votes
    WHERE senator_id = %(a)s AND position IN ('pour', 'contre', 'abstention')
), b AS MATERIALIZED (
    SELECT session, vote_number, position FROM public.individual_votes
    WHERE senator_id = %(b)s AND position IN ('pour', 'contre', 'abstention')
), pairs AS MATERIALIZED (
    SELECT v.session, v.number, v.vote_date, v.title, v.result,
           a.position AS pos_a, b.position AS pos_b
    FROM a
    JOIN b ON b.session = a.session AND b.vote_number = a.vote_number
    JOIN public.votes v ON v.session = a.session AND v.number = a.vote_number
)
SELECT
    (SELECT count(*) FROM public.senators WHERE id = %(a)s) AS found_a,
    (SELECT count(*) FROM public.senators WHERE id = %(b)s) AS found_b,
    count(*) AS shared,
    count(*) FILTER (WHERE pos_a = pos_b) AS agree,
    count(*) FILTER (WHERE pos_a = 'pour' AND pos_b = 'pour') AS both_pour,
    count(*) FILTER (WHERE pos_a = 'contre' AND pos_b = 'contre') AS both_contre,
    count(*) FILTER (WHERE pos_a = 'abstention' AND pos_b = 'abstention') AS both_abstention,
    count(*) FILTER (WHERE pos_a <> pos_b AND pos_a <> 'abstention' AND pos_b <> 'abstention') AS opposite,
    count(*) FILTER (WHERE pos_a <> pos_b AND (pos_a = 'abstention' OR pos_b = 'abstention')) AS one_abstained,
    min(vote_date) AS first_date,
    max(vote_date) AS last_date,
    (SELECT coalesce(json_agg(d ORDER BY d.vote_date DESC NULLS LAST, d.session DESC, d.number DESC), '[]'::json)
     FROM (SELECT session, number, vote_date, title, result, pos_a, pos_b FROM pairs
           WHERE pos_a <> pos_b
           ORDER BY vote_date DESC NULLS LAST, session DESC, number DESC
           LIMIT %(limit)s) d) AS disagreements
FROM pairs
"""


@router.get("/compare/{senator_a}/{senator_b}")
def compare_senators(
    request: Request,
    senator_a: SenatorId,
    senator_b: SenatorId,
    limit: Annotated[int, Query(ge=0, le=100, description="Latest disagreements to return")] = 20,
):
    if senator_a == senator_b:
        raise HTTPException(status_code=400, detail="Choose two different senators")
    # Cached per ordered pair until the importers commit (see app/cache.py).
    return cached_json_response(request, ("compare", senator_a, senator_b, limit),
                                lambda connection: build_comparison(connection, senator_a, senator_b, limit))


def build_comparison(connection, senator_a, senator_b, limit):
    row = connection.execute(COMPARE_SQL, {"a": senator_a, "b": senator_b, "limit": limit}).fetchone()
    for found, senator_id in ((row["found_a"], senator_a), (row["found_b"], senator_b)):
        if not found:
            # Raised inside the cache build: nothing is stored for unknown ids.
            raise HTTPException(status_code=404, detail=f"Senator {senator_id} not found")
    shared = row["shared"]
    return {
        "a": senator_a,
        "b": senator_b,
        "scope": "sitting_senators",
        "shared": shared,
        "agree": row["agree"],
        "agreementRate": round(row["agree"] / shared, 4) if shared else None,
        "breakdown": {
            "bothPour": row["both_pour"], "bothContre": row["both_contre"],
            "bothAbstention": row["both_abstention"], "opposite": row["opposite"],
            "oneAbstained": row["one_abstained"],
        },
        "firstDate": row["first_date"].isoformat() if row["first_date"] else None,
        "lastDate": row["last_date"].isoformat() if row["last_date"] else None,
        "disagreements": [{
            "session": d["session"], "number": d["number"], "date": d["vote_date"],
            "title": d["title"], "result": d["result"], "positionA": d["pos_a"], "positionB": d["pos_b"],
        } for d in row["disagreements"]],
    }
