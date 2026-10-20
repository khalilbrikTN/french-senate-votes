"""Individual votes (Dosleg `votsen`) of sitting senators, and vote corrections (`corscr`).

Scope: only senators whose senate_status is 'ACTIF' at import time. Rows already
stored for senators who have since left the Senate are kept untouched, so their
history stays available. Rows are upserted on (session, vote_number, senator_id).
vote_corrections is replaced in full.

Derived fields: group_code is the senator's group on the vote date, taken from
senator_group_memberships (NULL when there is not exactly one matching group).
"""

from collections import Counter, defaultdict

from .common import (LICENCE, PRODUCER, count, describe_file, fix_c1, fmt, iso, iter_dosleg_rows,
                     normalize_newlines, upsert_metadata, upsert_via_temp, utc_now)

METADATA_KEY = "source:data.senat.fr/dosleg/votsen"
POSITIONS = {"1": "pour", "2": "contre", "3": "abstention", "4": "non_votant"}
COLUMNS = ("session", "vote_number", "senator_id", "position", "group_code", "special_status",
           "delegated_by_senator_id", "has_correction")
CORRECTION_COLUMNS = ("session", "vote_number", "display_order", "text", "session_record_url")


def _load_reference(conn):
    sitting = {r["id"] for r in conn.execute("SELECT id FROM public.senators WHERE senate_status = 'ACTIF'")}
    known = {r["id"] for r in conn.execute("SELECT id FROM public.senators")}
    votes = {(r["session"], r["number"]): r["vote_date"]
             for r in conn.execute("SELECT session, number, vote_date FROM public.votes")}
    memberships = defaultdict(list)
    for r in conn.execute("SELECT senator_id, group_code, start_date, end_date FROM public.senator_group_memberships"):
        memberships[r["senator_id"]].append((r["start_date"], r["end_date"], r["group_code"]))
    return sitting, known, votes, memberships


def build_rows(dosleg, sitting, known, votes, memberships):
    raw_votes, statuses, corrections = [], {}, []
    source_rows = Counter()
    for table, r in iter_dosleg_rows(dosleg["path"], ["votsen", "stavot", "corscr"]):
        source_rows[table] += 1
        if table == "votsen":
            if r["senmat"] in sitting:
                raw_votes.append(r)
        elif table == "stavot":
            statuses[r["stavotidt"]] = r["stavotlib"]
        else:
            corrections.append(r)

    rows, skipped = [], Counter()
    for r in raw_votes:
        key = (r["sesann"], int(r["scrnum"]))
        if key not in votes:
            skipped["individual vote for a public vote missing from the database"] += 1
            continue
        if r["posvotcod"] not in POSITIONS:
            raise ValueError(f"Unknown position code {r['posvotcod']!r} for vote {key}")
        if r["stavotidt"] != "0" and r["stavotidt"] not in statuses:
            raise ValueError(f"Unknown special status {r['stavotidt']!r} for vote {key}")
        delegate = r["senmatdel"].strip() if r["senmatdel"] else None
        if delegate and delegate not in known:
            raise ValueError(f"Unknown delegating senator {delegate}")
        vote_date = votes[key]
        groups = {g for st, en, g in memberships[r["senmat"]]
                  if (st is None or st <= vote_date) and (en is None or en >= vote_date)}
        rows.append((key[0], key[1], r["senmat"], POSITIONS[r["posvotcod"]],
                     next(iter(groups)) if len(groups) == 1 else None,
                     statuses[r["stavotidt"]] if r["stavotidt"] != "0" else None,
                     delegate, (r["votsenmar"] or "").strip() == "*"))
    if len({r[:3] for r in rows}) != len(rows):
        raise ValueError("Duplicate (session, vote, senator) rows")

    correction_rows, per_vote = [], defaultdict(list)
    for i, r in enumerate(corrections):
        key = (r["sesann"], int(r["scrnum"]))
        text = normalize_newlines(fix_c1(r["corscrtxt"] or ""))
        if key not in votes:
            skipped["correction for a public vote missing from the database"] += 1
        elif not text:
            skipped["blank correction"] += 1
        else:
            order = int(r["corscrord"]) if r["corscrord"] is not None else 10**6
            per_vote[key].append((order, i, text, r["corscrurl"]))
    for key, items in per_vote.items():
        for order, (_, _, text, url) in enumerate(sorted(items)):
            correction_rows.append((key[0], key[1], order, text, url))
    return rows, correction_rows, skipped, source_rows


def run(conn, dosleg):
    """Import individual votes and corrections inside the current transaction. Returns run counts."""
    sitting, known, votes, memberships = _load_reference(conn)
    rows, correction_rows, skipped, source_rows = build_rows(dosleg, sitting, known, votes, memberships)
    voters = {r[2] for r in rows}
    print(f"Source: {fmt(source_rows['votsen'])} individual votes for all senators, "
          f"{fmt(source_rows['corscr'])} corrections")
    print(f"Prepared {fmt(len(rows))} individual votes for {len(voters)} of {len(sitting)} sitting senators, "
          f"{fmt(len(correction_rows))} corrections")
    print("  skipped: " + (", ".join(f"{fmt(n)} {reason}" for reason, n in skipped.items()) or "none"))
    positions = Counter(r[3] for r in rows)
    print(f"  positions: {', '.join(f'{fmt(n)} {p}' for p, n in positions.most_common())}; no group on vote date: "
          f"{fmt(sum(1 for r in rows if r[4] is None))}; special status: {fmt(sum(1 for r in rows if r[5]))}; "
          f"delegations: {fmt(sum(1 for r in rows if r[6]))}; corrections flagged: "
          f"{fmt(sum(1 for r in rows if r[7]))}")

    before = count(conn, "SELECT count(*) AS n FROM public.individual_votes")
    inserted, updated, _ = upsert_via_temp(conn, "individual_votes", COLUMNS,
                                        ("session", "vote_number", "senator_id"), rows)
    stats = conn.execute(
        """SELECT
             (SELECT count(*) FROM public.individual_votes) AS total,
             (SELECT count(*) FROM public.individual_votes iv
                JOIN tmp_individual_votes t USING (session, vote_number, senator_id)) AS matched,
             (SELECT count(*) FROM public.individual_votes iv
                JOIN public.senators s ON s.id = iv.senator_id
               WHERE s.senate_status IS DISTINCT FROM 'ACTIF') AS former,
             (SELECT count(*) FROM public.individual_votes iv
                JOIN public.senators s ON s.id = iv.senator_id AND s.senate_status = 'ACTIF'
               WHERE NOT EXISTS (SELECT 1 FROM tmp_individual_votes t
                                  WHERE t.session = iv.session AND t.vote_number = iv.vote_number
                                    AND t.senator_id = iv.senator_id)) AS sitting_not_in_source""").fetchone()
    if stats["matched"] != len(rows) or stats["total"] != before + inserted:
        raise RuntimeError(f"individual_votes counts {dict(stats)} do not match {fmt(len(rows))} prepared rows")

    old_corrections = Counter(tuple(r.values()) for r in conn.execute(
        f"SELECT {', '.join(CORRECTION_COLUMNS)} FROM public.vote_corrections"))
    new_corrections = Counter(correction_rows)
    conn.execute("DELETE FROM public.vote_corrections")
    with conn.cursor() as cur, cur.copy(
            f"COPY public.vote_corrections ({', '.join(CORRECTION_COLUMNS)}) FROM STDIN") as copy:
        for row in correction_rows:
            copy.write_row(row)
    corrections_after = count(conn, "SELECT count(*) AS n FROM public.vote_corrections")
    if corrections_after != len(correction_rows):
        raise RuntimeError(f"vote_corrections has {corrections_after} rows, expected {len(correction_rows)}")

    metadata = {
        "fetched_at": iso(utc_now()),
        "source_last_modified": dosleg["last_modified"],
        "licence": LICENCE,
        "producer": PRODUCER,
        "files": {"dosleg": {**describe_file(dosleg), "tables": ["votsen", "corscr"]}},
        "counts": {"individual_votes": len(rows), "senators_with_votes": len(voters),
                   "sitting_senators": len(sitting), "vote_corrections": len(correction_rows),
                   "individual_votes_in_database": stats["total"],
                   "individual_votes_of_former_senators_kept": stats["former"]},
        "coverage_notes": {
            "scope": "individual votes loaded only for senators sitting at import time; rows loaded earlier "
                     "for senators who have since left are kept; per-vote voter lists and group breakdowns "
                     "are therefore partial",
            "skipped": dict(skipped),
            "group_code_derived": "senator's group on the vote date from senator_group_memberships",
            "delegated_by_senator_id": "set on the row of the senator who cast another senator's delegated vote",
            "has_correction": "votsenmar '*': senator later stated an intended position (mise au point); "
                              "official position unchanged",
        },
    }
    upsert_metadata(conn, METADATA_KEY, metadata)

    print(f"individual votes: {fmt(len(rows))} in source (sitting senators), {fmt(before)} in DB before, "
          f"{fmt(inserted)} new, {fmt(updated)} updated, {fmt(len(rows) - inserted - updated)} unchanged, "
          f"{fmt(stats['total'])} in DB after")
    print(f"  kept: {fmt(stats['former'])} rows of senators no longer sitting")
    if stats["sitting_not_in_source"]:
        print(f"  note: {fmt(stats['sitting_not_in_source'])} rows of sitting senators are in the DB but not "
              f"in this export (kept as they are)")
    print(f"vote corrections: {fmt(len(correction_rows))} in source, {fmt(sum(old_corrections.values()))} in DB "
          f"before, {fmt(sum((new_corrections - old_corrections).values()))} added, "
          f"{fmt(sum((old_corrections - new_corrections).values()))} removed or changed (table replaced)")
    return {"senators_count": len(voters), "votes_count": 0}
