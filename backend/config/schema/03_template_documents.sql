-- Sample files stored with a template. Kept in sync with config/migrations/004_template_documents.sql.
-- template_id references templates.numeric_id (not the UUID primary key).
CREATE TABLE IF NOT EXISTS template_documents (
  id UUID PRIMARY KEY,
  template_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  extracted_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS template_documents_template
  ON template_documents (template_id, created_at ASC);
