-- Tighten source integrity before the database is populated with official history.

-- Vote dates are calendar dates, not free-form text.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'votes'
          AND column_name = 'vote_date' AND data_type = 'text'
    ) THEN
        ALTER TABLE public.votes
            ALTER COLUMN vote_date TYPE DATE USING NULLIF(vote_date, '')::DATE;
    END IF;
END $$;

-- Preserve display colors outside the official group facts.
CREATE TABLE IF NOT EXISTS public.political_group_display_settings (
    group_code TEXT PRIMARY KEY REFERENCES public.political_groups(code) ON DELETE CASCADE,
    color TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
    has_legacy_group_facts BOOLEAN;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'political_groups'
          AND column_name = 'color'
    ) THEN
        INSERT INTO public.political_group_display_settings(group_code, color)
            SELECT code, color FROM public.political_groups WHERE color IS NOT NULL
            ON CONFLICT (group_code) DO UPDATE SET color = EXCLUDED.color;
        ALTER TABLE public.political_groups DROP COLUMN color;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'political_groups'
          AND column_name = 'seats'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'political_groups'
          AND column_name = 'leader_name'
    ) THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.political_groups WHERE seats IS NOT NULL OR leader_name IS NOT NULL)'
            INTO has_legacy_group_facts;
        IF has_legacy_group_facts THEN
            RAISE EXCEPTION 'Move existing political group seats/leaders into official dated periods before applying this migration.';
        END IF;
    END IF;

    ALTER TABLE public.political_groups DROP COLUMN IF EXISTS seats;
    ALTER TABLE public.political_groups DROP COLUMN IF EXISTS leader_name;
END $$;

-- Dated snapshots hold fields that change during or between Senate sessions.
CREATE TABLE IF NOT EXISTS public.political_group_periods (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_code TEXT NOT NULL,
    session TEXT NOT NULL,
    group_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    seats INTEGER CHECK (seats IS NULL OR seats >= 0),
    leader_name TEXT,
    source_url TEXT NOT NULL,
    source_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT political_group_periods_code_session_start_key UNIQUE (group_code, session, start_date),
    CONSTRAINT political_group_periods_dates_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_political_group_periods_period
    ON public.political_group_periods(session, group_code, start_date, end_date);

-- Remove catalog FKs from time-specific source rows. Historical group codes
-- may no longer appear in the current political_groups catalog.
ALTER TABLE public.group_vote_totals
    DROP CONSTRAINT IF EXISTS group_vote_totals_group_code_fkey;
ALTER TABLE public.individual_votes
    DROP CONSTRAINT IF EXISTS individual_votes_group_code_fkey;
ALTER TABLE public.individual_votes
    DROP CONSTRAINT IF EXISTS individual_votes_senator_id_fkey;
ALTER TABLE public.individual_votes
    ADD CONSTRAINT individual_votes_senator_id_fkey
    FOREIGN KEY (senator_id) REFERENCES public.senators(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_vote_totals_source_order
    ON public.group_vote_totals(session, vote_number, source_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_individual_votes_source_order
    ON public.individual_votes(session, vote_number, position, source_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_individual_votes_senator_per_vote
    ON public.individual_votes(session, vote_number, senator_id)
    WHERE senator_id IS NOT NULL;

-- Keep version history for official vote pages. A snapshot_ref can point to an
-- archived response; the hash records the exact bytes that were checked.
CREATE TABLE IF NOT EXISTS public.vote_source_versions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session TEXT NOT NULL,
    vote_number INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    snapshot_ref TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vote_source_versions_hash_key UNIQUE (session, vote_number, content_sha256),
    FOREIGN KEY (session, vote_number)
        REFERENCES public.votes(session, number) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vote_source_versions_vote
    ON public.vote_source_versions(session, vote_number, first_seen_at);

-- Calculated metrics are not official senator facts.
CREATE TABLE IF NOT EXISTS public.senator_derived_stats (
    senator_id TEXT PRIMARY KEY REFERENCES public.senators(id) ON DELETE CASCADE,
    statistics JSONB NOT NULL DEFAULT '{}'::jsonb,
    methodology_version TEXT NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'senators'
          AND column_name = 'stats'
    ) THEN
        INSERT INTO public.senator_derived_stats(senator_id, statistics, methodology_version)
            SELECT id, stats, 'legacy-json-snapshot-v1'
            FROM public.senators WHERE stats <> '{}'::jsonb
            ON CONFLICT (senator_id) DO NOTHING;
        ALTER TABLE public.senators DROP COLUMN stats;
    END IF;
END $$;

ALTER TABLE public.political_group_display_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.political_group_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.senator_derived_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.political_group_display_settings,
    public.political_group_periods, public.vote_source_versions,
    public.senator_derived_stats FROM anon, authenticated;
