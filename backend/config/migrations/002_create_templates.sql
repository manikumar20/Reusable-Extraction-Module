CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS template_versions_latest
  ON template_versions (template_id, version DESC);

CREATE TABLE IF NOT EXISTS template_fields (
  id UUID PRIMARY KEY,
  template_version_id UUID NOT NULL REFERENCES template_versions (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  hint TEXT,
  format TEXT,
  validation TEXT,
  sample_page INTEGER,
  sample_x DOUBLE PRECISION,
  sample_y DOUBLE PRECISION,
  sample_w DOUBLE PRECISION,
  sample_h DOUBLE PRECISION
);

-- Only create the legacy index when that column still exists (schema may already use template_id).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'template_fields'
      AND column_name = 'template_version_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS template_fields_order ON template_fields (template_version_id, position)';
  END IF;
END $$;
