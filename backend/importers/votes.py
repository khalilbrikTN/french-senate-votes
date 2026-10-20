"""Public votes (scrutins publics) from the Dosleg table `scr` into public.votes.

Dosleg has no result column: the result is derived (adopté when pour > contre,
otherwise rejeté). Abstentions are derived as votants minus suffrages exprimés.
Rows are upserted on (session, number); votes are never deleted.
"""

from collections import Counter
from datetime import date

from .common import (LICENCE, PRODUCER, count, describe_file, describe_updates, fix_c1, fmt, iso,
                     iter_dosleg_rows, single_line, upsert_metadata, upsert_via_temp, utc_now)

METADATA_KEY = "source:data.senat.fr/dosleg/scr"
COLUMNS = ("session", "number", "vote_date", "title", "result", "votes_for", "votes_against",
           "abstentions", "total", "source_url", "source_order")


def build_rows(dosleg):
    rows, fixed_titles, joined_titles = [], 0, 0
    for order, (_, r) in enumerate(iter_dosleg_rows(dosleg["path"], ["scr"])):
        title = single_line(r["scrint"] or "")
        joined_titles += any(c in (r["scrint"] or "") for c in "\r\n")
        if not title:
            raise ValueError(f"Vote {r['sesann']}/{r['scrnum']} has no title")
        clean = fix_c1(title)
        fixed_titles += clean != title
        pour, contre, voters, expressed = (int(r[k]) for k in ("scrpou", "scrcon", "scrvot", "scrsuf"))
        if pour + contre != expressed or voters < expressed:
            raise ValueError(f"Inconsistent counts for vote {r['sesann']}/{r['scrnum']}")
        rows.append((
            r["sesann"], int(r["scrnum"]), date.fromisoformat(r["scrdat"][:10]), clean,
            "adopté" if pour > contre else "rejeté",
            pour, contre, voters - expressed, voters,
            f"https://www.senat.fr/scrutin-public/{r['sesann']}/scr{r['sesann']}-{r['scrnum']}.html",
            order,
        ))
    if not rows:
        raise ValueError("The Dosleg table scr is empty")
    if len({(r[0], r[1]) for r in rows}) != len(rows):
        raise ValueError("Duplicate (session, number) in source")
    return rows, fixed_titles, joined_titles


def run(conn, dosleg):
    """Import votes inside the current transaction. Returns run counts."""
    rows, fixed_titles, joined_titles = build_rows(dosleg)
    results = Counter(r[4] for r in rows)
    first, last = min(r[2] for r in rows), max(r[2] for r in rows)
    print(f"Source: {fmt(len(rows))} votes, sessions {min(r[0] for r in rows)}-{max(r[0] for r in rows)}, "
          f"{first} -> {last}, {fixed_titles} titles with repaired characters, "
          f"{joined_titles} titles with line breaks joined, "
          f"results: {fmt(results['adopté'])} adopté / {fmt(results['rejeté'])} rejeté")

    before = count(conn, "SELECT count(*) AS n FROM public.votes")
    inserted, updated, order_only = upsert_via_temp(conn, "votes", COLUMNS, ("session", "number"), rows,
                                                    order_column="source_order")
    db_only = count(conn, """SELECT count(*) AS n FROM public.votes v WHERE NOT EXISTS (
                                 SELECT 1 FROM tmp_votes t WHERE t.session = v.session AND t.number = v.number)""")
    after = count(conn, "SELECT count(*) AS n FROM public.votes")
    if after != before + inserted or after - db_only != len(rows):
        raise RuntimeError(f"votes table has {after} rows after import, expected {len(rows) + db_only}")

    metadata = {
        "fetched_at": iso(utc_now()),
        "source_last_modified": dosleg["last_modified"],
        "licence": LICENCE,
        "producer": PRODUCER,
        "files": {"dosleg": {**describe_file(dosleg), "table": "scr"}},
        "counts": {"votes": len(rows), "sessions": len({r[0] for r in rows}),
                   "first_vote_date": str(first), "last_vote_date": str(last)},
        "coverage_notes": {
            "result_is_derived_not_published": "adopté when pour > contre, otherwise rejeté (ties rejected); "
                                               "Dosleg has no result column and its majority field is 0 since 2012",
            "abstentions_derived": "votants (scrvot) minus suffrages exprimés (scrsuf)",
            "counts_are_final_not_announced_in_session": True,
            "titles_with_repaired_windows1252_characters": fixed_titles,
            "titles_with_line_breaks_joined_into_one_line": joined_titles,
            "individual_votes": "loaded separately, see source:data.senat.fr/dosleg/votsen",
        },
    }
    upsert_metadata(conn, METADATA_KEY, metadata)

    print(f"votes: {fmt(len(rows))} in source, {fmt(before)} in DB before, {fmt(inserted)} new, "
          f"{describe_updates(updated, order_only)}, {fmt(len(rows) - inserted - updated)} unchanged, "
          f"{fmt(after)} in DB after")
    if db_only:
        print(f"  note: {fmt(db_only)} votes in the DB are not in this export (kept as they are)")
    return {"senators_count": 0, "votes_count": len(rows)}
