ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS in_library BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE documents
SET in_library = TRUE
WHERE status = 'Completed';
