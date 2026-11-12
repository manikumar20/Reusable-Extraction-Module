-- One mutable template row per template_id (no version history).
CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE template_versions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

-- Collapse any leftover version history before enforcing one-row-per-template.
DELETE FROM template_versions
WHERE id NOT IN (
  SELECT keep.id
  FROM (
    SELECT DISTINCT ON (template_id) id
    FROM template_versions
    ORDER BY template_id, version DESC
  ) AS keep
);

UPDATE template_versions SET version = 1;

ALTER TABLE template_versions
  DROP CONSTRAINT IF EXISTS template_versions_template_id_version_key;

DROP INDEX IF EXISTS template_versions_latest;

CREATE UNIQUE INDEX IF NOT EXISTS template_versions_one_per_template
  ON template_versions (template_id);

CREATE UNIQUE INDEX IF NOT EXISTS template_versions_one_active
  ON template_versions (is_active)
  WHERE is_active;

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
  sample_h DOUBLE PRECISION,
  catalog_key TEXT,
  level TEXT NOT NULL DEFAULT 'line'
);

CREATE INDEX IF NOT EXISTS template_fields_order
  ON template_fields (template_version_id, position);

CREATE INDEX IF NOT EXISTS template_fields_catalog_key
  ON template_fields (catalog_key)
  WHERE catalog_key IS NOT NULL;

ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS catalog_key TEXT;
ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'line';
