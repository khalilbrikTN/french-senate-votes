-- Historical Senate service and political-group affiliation.
-- Keep these periods separate from the current senator profile so reelections
-- and mid-term group changes can be represented accurately.

CREATE TABLE IF NOT EXISTS public.senator_mandates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senator_id TEXT NOT NULL REFERENCES public.senators(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE,
    election_date DATE,
    department_name TEXT,
    department_code TEXT,
    source_url TEXT NOT NULL,
    source_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT senator_mandates_senator_start_key UNIQUE (senator_id, start_date),
    CONSTRAINT senator_mandates_dates_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.senator_group_memberships (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senator_id TEXT NOT NULL REFERENCES public.senators(id) ON DELETE CASCADE,
    group_code TEXT,
    group_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    source_url TEXT NOT NULL,
    source_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT senator_group_memberships_senator_start_key UNIQUE (senator_id, start_date),
    CONSTRAINT senator_group_memberships_dates_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_senator_mandates_period
    ON public.senator_mandates(senator_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_senator_group_memberships_period
    ON public.senator_group_memberships(senator_id, start_date, end_date);

ALTER TABLE public.senator_mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.senator_group_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.senator_mandates, public.senator_group_memberships
    FROM anon, authenticated;
