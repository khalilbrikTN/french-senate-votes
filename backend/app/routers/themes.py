"""/api/themes and /api/stats/themes: votes by theme (automatic classification from titles).

The theme of a vote comes from app/themes.py (keyword rules on the title): it is an
approximate, automatic classification, documented there.
"""

from collections import Counter
from datetime import datetime, timezone
import json

from fastapi import APIRouter, Request

from .. import cache, themes
from ..cache import cached_json_response
from . import legacy
from .legacy import APP_GROUP_CODES, MIN_GROUP_VOTERS

router = APIRouter(tags=["themes"])

NOTE = ("Thèmes attribués automatiquement à partir du titre des scrutins (mots-clés) : "
        "classement approximatif, un seul thème principal par scrutin.")


@router.get("/themes")
def theme_definitions():
    """The theme and vote-type ids and labels, in display order."""
    return {
        "themes": [{"id": theme_id, "label": label} for theme_id, label in themes.THEMES],
        "voteTypes": [{"id": type_id, "label": label} for type_id, label in themes.VOTE_TYPES],
        "note": NOTE,
    }


@router.get("/stats/themes")
def stats_themes(request: Request):
    # Aggregated from public.individual_votes; cached until the importers commit.
    return cached_json_response(request, ("stats-themes",), build_theme_stats)


def build_theme_stats(connection):
    """Per session x theme vote counts, and per session x theme x group majority positions.

    Titles are classified in Python (app/themes.py), then the mapping is passed to one SQL
    aggregation over individual_votes. Like /api/stats/groups, individual votes exist only
    for the senators sitting at import time: `sessions[].coverage` = individual
    pour/contre/abstention rows / official voters, and a group counts on a vote only when at
    least MIN_GROUP_VOTERS of its members expressed a position. `pour`, `contre`,
    `abstention` = votes where that was the group's strict majority position (ties count in
    `votes` only).
    """
    # Downloading the 4,776 titles again costs seconds (they are long); the cached
    # /api/scrutins list (warmed at startup) already carries each vote's theme.
    body, _, _ = cache.cached_body(("scrutins",), legacy.build_scrutins)
    mapping = []
    theme_votes = Counter()
    theme_adopted = Counter()
    for v in json.loads(body):
        theme = v.get("theme") or themes.classify_theme(v["title"])
        mapping.append({"s": v["session"], "n": v["number"], "t": theme})
        theme_votes[(v["session"], theme)] += 1
        if (v["result"] or "").lower().startswith("adopt"):
            theme_adopted[(v["session"], theme)] += 1

    row = connection.execute(
        """WITH vote_themes AS (
               SELECT s AS session, n AS number, t AS theme
               FROM jsonb_to_recordset(%(mapping)s::jsonb) AS m(s text, n int, t text)
           ),
           tallies AS MATERIALIZED (
               SELECT iv.session, iv.vote_number,
                      coalesce(%(aliases)s::jsonb ->> iv.group_code, iv.group_code, 'NI') AS grp,
                      count(*) FILTER (WHERE iv.position = 'pour') AS y,
                      count(*) FILTER (WHERE iv.position = 'contre') AS n,
                      count(*) FILTER (WHERE iv.position = 'abstention') AS a
               FROM public.individual_votes iv
               WHERE iv.position <> 'non_votant'
               GROUP BY 1, 2, 3
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
           per_theme AS (
               SELECT t.session, vt.theme, t.grp, count(*) AS votes,
                      count(*) FILTER (WHERE t.y > t.n AND t.y > t.a) AS pour,
                      count(*) FILTER (WHERE t.n > t.y AND t.n > t.a) AS contre,
                      count(*) FILTER (WHERE t.a > t.y AND t.a > t.n) AS abstention
               FROM tallies t
               JOIN vote_themes vt ON vt.session = t.session AND vt.number = t.vote_number
               WHERE t.y + t.n + t.a >= %(min_voters)s
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
                  'session', session, 'theme', theme, 'group', grp, 'votes', votes,
                  'pour', pour, 'contre', contre, 'abstention', abstention)
                  ORDER BY session, theme, grp) FROM per_theme) AS groups""",
        {"mapping": json.dumps(mapping), "aliases": json.dumps(APP_GROUP_CODES),
         "min_voters": MIN_GROUP_VOTERS},
    ).fetchone()

    return {
        "scope": "sitting_senators",
        "minGroupVoters": MIN_GROUP_VOTERS,
        "note": NOTE,
        "themes": [{"id": theme_id, "label": label} for theme_id, label in themes.THEMES],
        "sessions": row["sessions"] or [],
        "votes": [{"session": session, "theme": theme, "votes": count,
                   "adopted": theme_adopted[(session, theme)]}
                  for (session, theme), count in sorted(theme_votes.items())],
        "groups": row["groups"] or [],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
