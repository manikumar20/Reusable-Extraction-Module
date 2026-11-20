-- The compressed upload lives on the document row. Disk folders are not the store.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data BYTEA;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
