-- Sénat Votes initial PostgreSQL schema.
-- Votes are identified by session + number because Senate scrutin numbers reset.

CREATE TABLE IF NOT EXISTS public.political_groups (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    seats INTEGER,
    leader_name TEXT
);

CREATE TABLE IF NOT EXISTS public.senators (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL,
    title TEXT,
    group_code TEXT REFERENCES public.political_groups(code),
    group_full_name TEXT,
    department_name TEXT,
    department_code TEXT,
    commission TEXT,
    avatar_url TEXT,
    senate_url TEXT,
    profession TEXT,
    social JSONB NOT NULL DEFAULT '{}'::jsonb,
    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.votes (
    session TEXT NOT NULL,
    number INTEGER NOT NULL,
    vote_date TEXT,
    title TEXT NOT NULL,
    result TEXT NOT NULL,
    votes_for INTEGER NOT NULL DEFAULT 0,
    votes_against INTEGER NOT NULL DEFAULT 0,
    abstentions INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    source_url TEXT NOT NULL,
    source_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session, number)
);

-- Keep source group names and rows distinct even when the source has mislabeled
-- multiple groups with the same code (for example, several rows labeled NI).
CREATE TABLE IF NOT EXISTS public.group_vote_totals (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session TEXT NOT NULL,
    vote_number INTEGER NOT NULL,
    group_code TEXT NOT NULL REFERENCES public.political_groups(code),
    group_name TEXT NOT NULL,
    votes_for INTEGER NOT NULL DEFAULT 0,
    votes_against INTEGER NOT NULL DEFAULT 0,
    abstentions INTEGER NOT NULL DEFAULT 0,
    source_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session, vote_number)
        REFERENCES public.votes(session, number) ON DELETE CASCADE
);

-- Keep the source name even if it cannot yet be matched confidently to a senator.
CREATE TABLE IF NOT EXISTS public.individual_votes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session TEXT NOT NULL,
    vote_number INTEGER NOT NULL,
    senator_id TEXT REFERENCES public.senators(id),
    senator_name TEXT NOT NULL,
    position TEXT NOT NULL CHECK (position IN ('pour', 'contre', 'abstention', 'non_votant')),
    group_code TEXT REFERENCES public.political_groups(code),
    source_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session, vote_number)
        REFERENCES public.votes(session, number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.dataset_metadata (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS public.import_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    senators_count INTEGER NOT NULL DEFAULT 0,
    votes_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_votes_date ON public.votes(vote_date);
CREATE INDEX IF NOT EXISTS idx_votes_session_date ON public.votes(session, vote_date);
CREATE INDEX IF NOT EXISTS idx_senators_group ON public.senators(group_code);
CREATE INDEX IF NOT EXISTS idx_individual_votes_senator ON public.individual_votes(senator_id);
CREATE INDEX IF NOT EXISTS idx_individual_votes_vote ON public.individual_votes(session, vote_number);
CREATE INDEX IF NOT EXISTS idx_group_vote_totals_vote ON public.group_vote_totals(session, vote_number);

-- Data is private by default. A later public API should use deliberate least-
-- privilege grants and policies instead of exposing the tables directly.
ALTER TABLE public.political_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.senators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_vote_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.individual_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.political_groups, public.senators, public.votes,
    public.group_vote_totals, public.individual_votes, public.dataset_metadata,
    public.import_runs FROM anon, authenticated;
