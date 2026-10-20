-- Group presidents as dated periods, and a link from a period to the senator.
--
-- political_group_periods was created with a `session` column (see
-- 20261020020000). Group presidencies are dated by the Senate
-- (ODSEN_HISTOGROUPES function start/end) and do not belong to a session, so a
-- period is keyed by (group_code, start_date) instead. Seats stay NULL: seat
-- counts are computed live from senators.
--
-- Idempotent: safe to run again.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'political_group_periods'
          AND column_name = 'session'
    ) THEN
        IF EXISTS (SELECT 1 FROM public.political_group_periods) THEN
            RAISE EXCEPTION 'political_group_periods has rows: move or delete them before dropping its session column.';
        END IF;
        -- Drops the (group_code, session, start_date) constraint and the
        -- (session, group_code, start_date, end_date) index with the column.
        ALTER TABLE public.political_group_periods DROP COLUMN session;
    END IF;
END $$;

ALTER TABLE public.political_group_periods
    DROP CONSTRAINT IF EXISTS political_group_periods_code_session_start_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.political_group_periods'::regclass
          AND conname = 'political_group_periods_code_start_key'
    ) THEN
        ALTER TABLE public.political_group_periods
            ADD CONSTRAINT political_group_periods_code_start_key UNIQUE (group_code, start_date);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_political_group_periods_period
    ON public.political_group_periods(group_code, start_date, end_date);

-- The president's matricule (NULL when the source does not name a senator).
ALTER TABLE public.political_group_periods
    ADD COLUMN IF NOT EXISTS leader_senator_id TEXT REFERENCES public.senators(id);

CREATE INDEX IF NOT EXISTS idx_political_group_periods_leader
    ON public.political_group_periods(leader_senator_id);

-- Internal tables: the API reads them with its own role; no anon access.
ALTER TABLE public.political_group_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.political_group_display_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.political_group_periods,
    public.political_group_display_settings FROM anon, authenticated;
