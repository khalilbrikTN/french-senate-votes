"""Shared SQL fragments and helpers."""


def like_pattern(text):
    """Escape user text for a case-insensitive substring match with ILIKE."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


SENATOR_SUMMARY_COLUMNS = """
    s.id, s.full_name, s.first_name, s.last_name, s.title, s.senate_status AS status,
    s.group_code, s.group_full_name AS group_name, s.department_name, s.department_code,
    s.avatar_url, s.senate_url
"""

# The group's president today: the political_group_periods row (from
# ODSEN_HISTOGROUPES) that has started and has no end date or ends today or later.
# Use with a political_groups alias `g`; adds leader_name, leader_senator_id, leader_since.
CURRENT_LEADER_JOIN = """
    LEFT JOIN LATERAL (
        SELECT p.leader_name, p.leader_senator_id, p.start_date AS leader_since
        FROM public.political_group_periods p
        WHERE p.group_code = g.code AND p.start_date <= CURRENT_DATE
          AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE)
        ORDER BY p.start_date DESC LIMIT 1
    ) leader ON true
"""

VOTE_SUMMARY_COLUMNS = """
    v.session, v.number, v.vote_date, v.title, v.result, v.votes_for, v.votes_against,
    v.abstentions, v.total, v.source_url
"""
