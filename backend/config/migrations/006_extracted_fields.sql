-- Active template lives on the template, not in app_settings.
ALTER TABLE template_versions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS template_versions_one_active
  ON template_versions (is_active)
  WHERE is_active;

DO $$
BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    UPDATE template_versions AS versions
    SET is_active = TRUE
    WHERE versions.template_id::text = (
      SELECT value FROM app_settings WHERE key = 'active_template_id'
    )
    AND versions.version = (
      SELECT MAX(latest.version)
      FROM template_versions AS latest
      WHERE latest.template_id = versions.template_id
    );
  END IF;
END $$;

DROP TABLE IF EXISTS app_settings;

-- Fields extracted from an uploaded document.
CREATE TABLE IF NOT EXISTS document_extractions (
  id UUID PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  template_id UUID,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_extractions_document
  ON document_extractions (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_extracted_fields (
  id UUID PRIMARY KEY,
  extraction_id UUID NOT NULL REFERENCES document_extractions (id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('header', 'line')),
  line_index INTEGER NOT NULL DEFAULT 0,
  field_key TEXT NOT NULL,
  field_value JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS document_extracted_fields_order
  ON document_extracted_fields (extraction_id, scope, line_index, field_key);
