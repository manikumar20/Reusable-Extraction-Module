ALTER TABLE extracted_fields
  ADD COLUMN IF NOT EXISTS source_location jsonb NULL;
