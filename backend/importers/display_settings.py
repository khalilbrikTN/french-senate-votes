"""Group display colours: backend/importers/group_colors.json -> political_group_display_settings.

The colours are an editorial choice of this site, not Senate data. The JSON file
maps the Senate's internal group codes (UMP, SOC, CRC...) to hex colours. Rows are
upserted; codes that are not in political_groups are skipped with a warning (run
`senators` first). Rows in the database for codes no longer in the file are kept
and reported.
"""

import json
import re

from .common import IMPORTERS_DIR, count, fmt, iso, upsert_metadata, upsert_via_temp, utc_now

COLORS_FILE = IMPORTERS_DIR / "group_colors.json"
METADATA_KEY = "config:group_colors"
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def get_sources(path=COLORS_FILE):
    return {"path": path}


def load_colors(path):
    colors = json.loads(path.read_text(encoding="utf-8")).get("colors")
    if not isinstance(colors, dict) or not colors:
        raise ValueError(f"{path.name}: expected a non-empty \"colors\" object")
    bad = {code: color for code, color in colors.items() if not isinstance(color, str) or not _HEX.match(color)}
    if bad:
        raise ValueError(f"{path.name}: colours must be #rrggbb: {bad}")
    return {code: color.lower() for code, color in colors.items()}


def run(conn, source):
    path = source["path"]
    colors = load_colors(path)
    known = {r["code"] for r in conn.execute("SELECT code FROM public.political_groups")}
    unknown = sorted(set(colors) - known)
    rows = sorted((code, color) for code, color in colors.items() if code in known)
    print(f"Source: {path.name}, {fmt(len(colors))} group colours")
    if unknown:
        print(f"  warning: skipped {len(unknown)} codes not in political_groups: {', '.join(unknown)}")

    before = {r["group_code"]: r["color"] for r in conn.execute(
        "SELECT group_code, color FROM public.political_group_display_settings")}
    inserted, updated, _ = upsert_via_temp(
        conn, "political_group_display_settings", ("group_code", "color"), ("group_code",), rows)
    # New rows get updated_at by default; also stamp the rows whose colour changed.
    changed = [code for code, color in rows if code in before and before[code] != color]
    if changed:
        conn.execute("UPDATE public.political_group_display_settings SET updated_at = now() "
                     "WHERE group_code = ANY(%s)", (changed,))
    db_only = sorted(set(before) - {code for code, _ in rows})
    upsert_metadata(conn, METADATA_KEY, {
        "file": f"backend/importers/{path.name}", "loaded_at": iso(utc_now()),
        "colors": len(rows), "skipped_unknown_codes": unknown,
        "note": "Display colours chosen for this site; not Senate data.",
    })

    print(f"display colours: {fmt(len(rows))} to load, {fmt(len(before))} in DB before, "
          f"{fmt(inserted)} new, {fmt(updated)} changed, {fmt(len(rows) - inserted - updated)} unchanged")
    for code in changed:
        print(f"  {code}: {before[code]} -> {colors[code]}")
    if db_only:
        print(f"  note: {len(db_only)} colours in the DB are not in the file (kept): {', '.join(db_only)}")
    total = count(conn, "SELECT count(*) AS n FROM public.political_group_display_settings")
    print(f"  {fmt(total)} group colours in the DB after this step")
    return {"senators_count": 0, "votes_count": 0}
