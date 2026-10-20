-- Prepare senator tables for the official data.senat.fr senator exports.

-- ODSEN_HISTOGROUPES publishes many older memberships without a start date.
-- Keep those rows as published; NULL means the Senate did not record a start.
ALTER TABLE public.senator_group_memberships
    ALTER COLUMN start_date DROP NOT NULL;

-- Official ACTIF/ANCIEN state from ODSEN_GENERAL, so current and former
-- senators can be distinguished without inferring it from mandate dates.
ALTER TABLE public.senators
    ADD COLUMN IF NOT EXISTS senate_status TEXT
    CHECK (senate_status IN ('ACTIF', 'ANCIEN'));

CREATE INDEX IF NOT EXISTS idx_senators_senate_status
    ON public.senators(senate_status);
