ALTER TABLE template_documents
  ADD COLUMN IF NOT EXISTS extracted_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
