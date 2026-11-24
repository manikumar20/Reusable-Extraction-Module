ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS in_library BOOLEAN NOT NULL DEFAULT FALSE;

-- Do not blanket-update Completed rows here.
-- This file is re-applied on server boot; a mass UPDATE would publish
-- unpublished extractions into Documents on every restart.
