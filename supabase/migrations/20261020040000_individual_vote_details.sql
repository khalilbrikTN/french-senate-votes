-- Individual votes from Dosleg `votsen` and post-vote corrections from `corscr`.
--
-- Dosleg identifies voters by matricule only (no names, no ordering), so
-- individual_votes is keyed by (session, vote_number, senator_id) and keeps the
-- official per-vote details: special status, delegation and correction flag.

DO $$
BEGIN
    -- Restructure only the original draft table (it still has the surrogate id).
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'individual_votes' AND column_name = 'id'
    ) THEN
        IF EXISTS (SELECT 1 FROM public.individual_votes) THEN
            RAISE EXCEPTION 'individual_votes must be empty before it is restructured';
        END IF;
        DROP INDEX IF EXISTS public.uq_individual_votes_source_order;
        DROP INDEX IF EXISTS public.uq_individual_votes_senator_per_vote;
        DROP INDEX IF EXISTS public.idx_individual_votes_vote;
        ALTER TABLE public.individual_votes DROP CONSTRAINT IF EXISTS individual_votes_pkey;
        ALTER TABLE public.individual_votes DROP CONSTRAINT IF EXISTS individual_votes_senator_id_fkey;
        ALTER TABLE public.individual_votes
            DROP COLUMN id,
            DROP COLUMN senator_name,
            DROP COLUMN source_order,
            ALTER COLUMN senator_id SET NOT NULL,
            ADD CONSTRAINT individual_votes_pkey PRIMARY KEY (session, vote_number, senator_id),
            ADD CONSTRAINT individual_votes_senator_id_fkey
                FOREIGN KEY (senator_id) REFERENCES public.senators(id);
    END IF;
END $$;

-- Official reason a senator did not take part, e.g. 'Président de séance',
-- 'Membre du gouvernement', 'Déport'. NULL when the source has no special status.
ALTER TABLE public.individual_votes ADD COLUMN IF NOT EXISTS special_status TEXT;

-- Set on the row of the senator who received a delegation: this senator also
-- cast the vote of delegated_by_senator_id (ordonnance n° 58-1066).
ALTER TABLE public.individual_votes ADD COLUMN IF NOT EXISTS delegated_by_senator_id TEXT
    REFERENCES public.senators(id);

-- The senator later stated (mise au point) that they would have voted
-- differently. The official position is unchanged.
ALTER TABLE public.individual_votes ADD COLUMN IF NOT EXISTS has_correction BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.individual_votes.group_code IS
    'Derived: the senator''s group code on the vote date, from senator_group_memberships';

-- Mises au point: statements made after a vote about intended positions.
CREATE TABLE IF NOT EXISTS public.vote_corrections (
    session TEXT NOT NULL,
    vote_number INTEGER NOT NULL,
    display_order INTEGER NOT NULL,
    text TEXT NOT NULL,
    session_record_url TEXT,
    PRIMARY KEY (session, vote_number, display_order),
    FOREIGN KEY (session, vote_number) REFERENCES public.votes(session, number) ON DELETE CASCADE
);

ALTER TABLE public.vote_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vote_corrections FROM anon, authenticated;
