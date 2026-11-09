-- All extracted or edited field values for an uploaded document.
-- document_id matches documents.id (integer identity).
CREATE TABLE IF NOT EXISTS extracted_fields (
  id UUID PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  field_name VARCHAR(200) NOT NULL,
  field_key VARCHAR(120) NOT NULL,
  field_value TEXT NOT NULL DEFAULT '',
  data_type VARCHAR(40) NOT NULL DEFAULT 'STRING',
  source VARCHAR(20) NOT NULL DEFAULT 'AI',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS extracted_fields_document
  ON extracted_fields (document_id, created_at ASC);
