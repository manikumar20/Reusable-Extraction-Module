CREATE TABLE IF NOT EXISTS template_documents (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS template_documents_template
  ON template_documents (template_id, created_at ASC);
