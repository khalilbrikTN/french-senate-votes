"""Senators, political groups, Senate mandates and group memberships.

Sources (Licence Ouverte 2.0, producer: Sénat):
- ODSEN_GENERAL: every current and former senator, keyed by matricule.
- ODSEN_ELUSEN: Senate mandates (terms), current and historical.
- ODSEN_HISTOGROUPES: political group memberships, current and historical.
- senat.fr senateurs.json: the sitting senators' current group, constituency,
  portrait and profile URL.

Group presidents come from the ODSEN_HISTOGROUPES rows whose function is
"Président": one political_group_periods row per presidency. Presidencies the
Senate published without a start date are skipped and counted (start_date is
required and is never invented). Seats are not stored there: they are counted
live from senators.

Rows are stored as published. Missing official values stay NULL; nothing is
inferred. senators and political_groups are upserted; the senator_mandates,
senator_group_memberships and political_group_periods rows that come from these
files are replaced.
"""

from collections import Counter
from datetime import date
import json
from pathlib import Path
from urllib.parse import urljoin

from psycopg.types.json import Jsonb

from .common import (CACHE_DIR, LICENCE, PRODUCER, count, describe_file, describe_updates, download,
                     file_info, fmt, iso, upsert_metadata, upsert_via_temp, utc_now)

SENAT_BASE_URL = "https://www.senat.fr"
SOURCES = {
    "general": ("ODSEN_GENERAL.json", "https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json"),
    "mandates": ("ODSEN_ELUSEN.json", "https://data.senat.fr/data/senateurs/ODSEN_ELUSEN.json"),
    "groups": ("ODSEN_HISTOGROUPES.json", "https://data.senat.fr/data/senateurs/ODSEN_HISTOGROUPES.json"),
    "current": ("api_senateurs.json", "https://www.senat.fr/api-senat/senateurs.json"),
}
METADATA_KEY = "source:data.senat.fr/senateurs"
SENATOR_COLUMNS = ("id", "slug", "first_name", "last_name", "full_name", "title", "group_code",
                   "group_full_name", "department_name", "department_code", "commission", "avatar_url",
                   "senate_url", "profession", "social", "senate_status", "source_order")
MANDATE_COLUMNS = ("senator_id", "start_date", "end_date", "election_date", "department_name",
                   "department_code", "source_url", "source_checked_at")
MEMBERSHIP_COLUMNS = ("senator_id", "group_code", "group_name", "start_date", "end_date",
                      "source_url", "source_checked_at")
# political_group_periods.seats is left NULL (seat counts are computed live).
PERIOD_COLUMNS = ("group_code", "start_date", "end_date", "leader_name", "leader_senator_id", "group_name",
                  "source_url", "source_checked_at")
PRESIDENT_FUNCTION = "Président"


def get_sources(senat_dir=None):
    """Return {name: file info} from senat_dir, or download the four files into the cache."""
    if senat_dir:
        return {name: file_info(Path(senat_dir) / filename, url)
                for name, (filename, url) in SOURCES.items()}
    print("Downloading senator files...")
    return {name: download(url, CACHE_DIR / filename) for name, (filename, url) in SOURCES.items()}


def parse_source_date(value):
    # data.senat.fr publishes dates as "YYYY/MM/DD 00:00:00".
    if not value:
        return None
    return date.fromisoformat(str(value)[:10].replace("/", "-"))


def blank_to_none(value):
    value = (value or "").strip()
    return value or None


def build_rows(files, checked_at):
    payloads = {name: json.loads(Path(info["path"]).read_bytes().decode("utf-8"))
                for name, info in files.items()}
    general = payloads["general"]["results"]
    mandates = payloads["mandates"]["results"]
    memberships = payloads["groups"]["results"]
    current = {row["matricule"]: row for row in payloads["current"]}

    matricules = [row["Matricule"] for row in general]
    duplicates = [m for m, n in Counter(matricules).items() if n > 1]
    if duplicates:
        raise ValueError(f"ODSEN_GENERAL repeats matricules: {duplicates[:5]}")
    known = set(matricules)
    statuses = Counter(row["Etat"] for row in general)
    if set(statuses) - {"ACTIF", "ANCIEN"}:
        raise ValueError(f"Unexpected senator states: {dict(statuses)}")
    active = {row["Matricule"] for row in general if row["Etat"] == "ACTIF"}
    if set(current) != active:
        raise ValueError(
            "senateurs.json and ODSEN_GENERAL disagree on sitting senators: "
            f"{len(set(current) - active)} only in the API, {len(active - set(current))} only in ODSEN_GENERAL")

    groups = {}
    for row in memberships:
        if row["Code_du_groupe_politique"]:
            groups.setdefault(row["Code_du_groupe_politique"], row["Nom_court_du_groupe_politique"])
    for row in current.values():
        group = row.get("groupe") or {}
        if group.get("code"):
            groups[group["code"]] = group.get("libelle") or group["code"]

    senator_rows = []
    for order, row in enumerate(general):
        api = current.get(row["Matricule"])
        group = (api or {}).get("groupe") or {}
        constituency = (api or {}).get("circonscription") or {}
        first_name, last_name = row["Prenom_usuel"] or "", row["Nom_usuel"] or ""
        senator_rows.append((
            row["Matricule"],
            Path(api["url"]).stem if api and api.get("url") else None,
            first_name, last_name, f"{first_name} {last_name}".strip(), row["Qualite"],
            group.get("code"), group.get("libelle"),
            constituency.get("libelle") or row["Circonscription"], constituency.get("code"),
            blank_to_none(row["Commission_permanente"]),
            urljoin(SENAT_BASE_URL, api["urlAvatar"]) if api and api.get("urlAvatar") else None,
            urljoin(SENAT_BASE_URL, api["url"]) if api and api.get("url") else None,
            blank_to_none(row["Description_de_la_profession"]),
            Jsonb({"twitter": api.get("twitter"), "facebook": api.get("facebook")} if api else {}),
            row["Etat"], order,
        ))

    mandates_url = files["mandates"]["url"]
    mandate_rows, mandate_keys = [], Counter()
    for row in mandates:
        if row["Matricule"] not in known:
            raise ValueError(f"Mandate for unknown senator {row['Matricule']}")
        start = parse_source_date(row["Date_de_debut_de_mandat"])
        if start is None:
            raise ValueError(f"Mandate without start date for {row['Matricule']}")
        mandate_keys[(row["Matricule"], start)] += 1
        mandate_rows.append((
            row["Matricule"], start, parse_source_date(row["Date_de_fin_de_mandat"]),
            parse_source_date(row["Date_d_election"]), None, None, mandates_url, checked_at,
        ))
    if any(n > 1 for n in mandate_keys.values()):
        raise ValueError("ODSEN_ELUSEN has several mandates with the same senator and start date")

    # ODSEN_HISTOGROUPES has one row per function held (Membre, Président...)
    # within a membership; keep one row per official membership id.
    groups_url = files["groups"]["url"]
    by_membership = {}
    for row in memberships:
        if row["Matricule"] not in known:
            raise ValueError(f"Group membership for unknown senator {row['Matricule']}")
        fields = (row["Matricule"], row["Code_du_groupe_politique"], row["Date_de_debut_d_appartenance"],
                  row["Date_de_fin_d_appartenance"])
        previous = by_membership.setdefault(row["Id_appartenance"], (fields, row))[0]
        if previous != fields:
            raise ValueError(f"Membership {row['Id_appartenance']} has conflicting rows")
    membership_rows, dated_keys = [], Counter()
    for _, row in by_membership.values():
        start = parse_source_date(row["Date_de_debut_d_appartenance"])
        if start is not None:
            dated_keys[(row["Matricule"], start)] += 1
        membership_rows.append((
            row["Matricule"], row["Code_du_groupe_politique"], row["Nom_court_du_groupe_politique"],
            start, parse_source_date(row["Date_de_fin_d_appartenance"]), groups_url, checked_at,
        ))
    if any(n > 1 for n in dated_keys.values()):
        raise ValueError("ODSEN_HISTOGROUPES has several memberships with the same senator and start date")
    period_rows, presidents = build_president_periods(memberships, groups_url, checked_at)

    today = checked_at.date()
    current_mandate = {r[0] for r in mandate_rows if r[2] is None or r[2] >= today}
    metadata = {
        "fetched_at": iso(checked_at),
        "licence": LICENCE,
        "producer": PRODUCER,
        "files": {name: describe_file(info) for name, info in files.items()},
        "counts": {
            "senators": len(senator_rows), "sitting_senators": len(active),
            "mandates": len(mandate_rows), "group_memberships": len(membership_rows),
            "political_groups": len(groups),
            "group_presidencies": len(period_rows),
        },
        "coverage_notes": {
            "sitting_senators_without_current_mandate_in_ODSEN_ELUSEN": len(active - current_mandate),
            "group_memberships_without_start_date": sum(1 for r in membership_rows if r[3] is None),
            "mandate_department_not_published_in_ODSEN_ELUSEN": True,
            "group_name_is_current_name_of_the_group_code_not_historical_label": True,
            "group_presidencies_without_start_date_skipped": len(presidents["undated"]),
            "group_presidencies_skipped_conflicting_same_group_and_start": len(presidents["conflicts"]),
            "political_group_periods_seats_not_stored_computed_live_from_senators": True,
        },
    }
    return groups, senator_rows, mandate_rows, membership_rows, period_rows, presidents, metadata


def build_president_periods(memberships, source_url, checked_at):
    """One political_group_periods row per group presidency in ODSEN_HISTOGROUPES.

    Returns (rows, report). Undated presidencies are skipped (start_date is
    required and never invented). Rows repeated with the same values are kept
    once; different presidencies sharing a (group, start date) key are all
    skipped and reported.
    """
    by_key, undated, repeated = {}, [], 0
    for row in memberships:
        if row["Nom_court_fonction"] != PRESIDENT_FUNCTION:
            continue
        leader = f"{row['Prenom'] or ''} {row['Nom'] or ''}".strip() or None
        start = parse_source_date(row["Date_de_debut_de_la_fonction"])
        end = parse_source_date(row["Date_de_fin_de_la_fonction"])
        if start is None:
            undated.append((row["Code_du_groupe_politique"], leader, end))
            continue
        period = (row["Code_du_groupe_politique"], start, end, leader, row["Matricule"],
                  row["Nom_court_du_groupe_politique"], source_url, checked_at)
        by_key.setdefault((period[0], start), []).append(period)
    rows, conflicts = [], []
    for key, periods in sorted(by_key.items()):
        distinct = list(dict.fromkeys(p[:6] for p in periods))
        if len(distinct) > 1:
            conflicts.append((key, [(p[3], p[4]) for p in distinct]))
            continue
        repeated += len(periods) - 1
        rows.append(periods[0])
    today = checked_at.date()
    current = {r[0]: r for r in rows if r[2] is None or r[2] >= today}
    return rows, {"undated": undated, "conflicts": conflicts, "repeated": repeated, "current": current}


def _replace_owned_rows(conn, table, columns, compare_columns, source_url, rows):
    """Replace the rows of `table` that come from `source_url`; return (before, added, removed)."""
    compare = ", ".join(compare_columns)
    old = Counter(tuple(r.values()) for r in conn.execute(
        f"SELECT {compare} FROM public.{table} WHERE source_url = %s", (source_url,)))
    width = len(compare_columns)
    new = Counter(row[:width] for row in rows)
    conn.execute(f"DELETE FROM public.{table} WHERE source_url = %s", (source_url,))
    with conn.cursor() as cur, cur.copy(f"COPY public.{table} ({', '.join(columns)}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)
    return sum(old.values()), sum((new - old).values()), sum((old - new).values())


def run(conn, files):
    """Import senator data inside the current transaction. Returns run counts."""
    checked_at = utc_now()
    groups, senator_rows, mandate_rows, membership_rows, period_rows, presidents, metadata = build_rows(
        files, checked_at)
    counts = metadata["counts"]
    print(f"Source: {fmt(counts['senators'])} senators ({fmt(counts['sitting_senators'])} sitting), "
          f"{fmt(counts['political_groups'])} political groups, {fmt(counts['mandates'])} mandates, "
          f"{fmt(counts['group_memberships'])} group memberships")

    before_status = {r["id"]: r["senate_status"] for r in conn.execute(
        "SELECT id, senate_status FROM public.senators")}
    groups_before = count(conn, "SELECT count(*) AS n FROM public.political_groups")

    g_ins, g_upd, _ = upsert_via_temp(conn, "political_groups", ("code", "name"), ("code",),
                                   sorted(groups.items()))
    s_ins, s_upd, s_order = upsert_via_temp(conn, "senators", SENATOR_COLUMNS, ("id",), senator_rows,
                                            order_column="source_order")
    db_only = count(conn, """SELECT count(*) AS n FROM public.senators s
                             WHERE NOT EXISTS (SELECT 1 FROM tmp_senators t WHERE t.id = s.id)""")

    m_before, m_added, m_removed = _replace_owned_rows(
        conn, "senator_mandates", MANDATE_COLUMNS, MANDATE_COLUMNS[:6], files["mandates"]["url"], mandate_rows)
    gm_before, gm_added, gm_removed = _replace_owned_rows(
        conn, "senator_group_memberships", MEMBERSHIP_COLUMNS, MEMBERSHIP_COLUMNS[:5],
        files["groups"]["url"], membership_rows)
    p_before, p_added, p_removed = _replace_owned_rows(
        conn, "political_group_periods", PERIOD_COLUMNS, PERIOD_COLUMNS[:6], files["groups"]["url"], period_rows)
    upsert_metadata(conn, METADATA_KEY, metadata)

    after = conn.execute(
        """SELECT (SELECT count(*) FROM public.senators WHERE id = ANY(%s)) AS senators,
                  (SELECT count(*) FROM public.senator_mandates WHERE source_url = %s) AS mandates,
                  (SELECT count(*) FROM public.senator_group_memberships WHERE source_url = %s) AS memberships,
                  (SELECT count(*) FROM public.political_group_periods WHERE source_url = %s) AS periods""",
        ([row[0] for row in senator_rows], files["mandates"]["url"], files["groups"]["url"],
         files["groups"]["url"])).fetchone()
    expected = {"senators": len(senator_rows), "mandates": len(mandate_rows), "memberships": len(membership_rows),
                "periods": len(period_rows)}
    if dict(after) != expected:
        raise RuntimeError(f"Row counts after import {dict(after)} do not match {expected}")

    new_status = {row[0]: row[15] for row in senator_rows}
    now_sitting = sum(1 for k, v in new_status.items() if v == "ACTIF" and before_status.get(k) != "ACTIF")
    left = sum(1 for k, v in new_status.items() if v != "ACTIF" and before_status.get(k) == "ACTIF")

    print(f"senators: {fmt(len(senator_rows))} in source, {fmt(len(before_status))} in DB before, "
          f"{fmt(s_ins)} new, {describe_updates(s_upd, s_order)}, "
          f"{fmt(len(senator_rows) - s_ins - s_upd)} unchanged")
    print(f"  newly sitting: {now_sitting}, no longer sitting: {left}")
    if db_only:
        print(f"  note: {fmt(db_only)} senators in the DB are not in ODSEN_GENERAL (kept as they are)")
    print(f"political groups: {fmt(len(groups))} in source, {fmt(groups_before)} in DB before, "
          f"{fmt(g_ins)} new, {fmt(g_upd)} renamed")
    print(f"mandates: {fmt(len(mandate_rows))} in source, {fmt(m_before)} in DB before, "
          f"{fmt(m_added)} added, {fmt(m_removed)} removed or changed (rows from this file replaced)")
    print(f"group memberships: {fmt(len(membership_rows))} in source, {fmt(gm_before)} in DB before, "
          f"{fmt(gm_added)} added, {fmt(gm_removed)} removed or changed (rows from this file replaced)")
    print(f"group presidencies: {fmt(len(period_rows))} in source, {fmt(p_before)} in DB before, "
          f"{fmt(p_added)} added, {fmt(p_removed)} removed or changed (rows from this file replaced)")
    if presidents["undated"]:
        print(f"  skipped {len(presidents['undated'])} presidencies without a start date in the source: "
              + "; ".join(f"{code} {name} (ended {end or '?'})" for code, name, end in presidents["undated"]))
    if presidents["repeated"]:
        print(f"  {presidents['repeated']} repeated presidency rows kept once")
    for (code, start), people in presidents["conflicts"]:
        print(f"  WARNING: skipped conflicting presidencies of {code} starting {start}: "
              + ", ".join(f"{name} ({matricule})" for name, matricule in people))
    print("  current presidents: " + ("; ".join(
        f"{code} {r[3]} (since {r[1]})" for code, r in sorted(presidents["current"].items())) or "none"))
    notes = metadata["coverage_notes"]
    print(f"  coverage: {notes['sitting_senators_without_current_mandate_in_ODSEN_ELUSEN']} sitting senators "
          f"without a current mandate in ODSEN_ELUSEN, {fmt(notes['group_memberships_without_start_date'])} "
          f"memberships without start date")
    return {"senators_count": len(senator_rows), "votes_count": 0}
