-- One row per template (no version history table).
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Collapse legacy template_versions into templates when present.
DO $$
BEGIN
  IF to_regclass('public.template_versions') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO templates (id, name, version, category, is_active, created_at, updated_at)
  SELECT DISTINCT ON (template_id)
    template_id,
    name,
    1,
    category,
    COALESCE(is_active, FALSE),
    created_at,
    updated_at
  FROM template_versions
  ORDER BY template_id, version DESC, updated_at DESC
  ON CONFLICT (id) DO NOTHING;

  IF to_regclass('public.template_fields') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'template_fields'
         AND column_name = 'template_version_id'
     ) THEN
    ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS template_id UUID;

    UPDATE template_fields AS fields
    SET template_id = versions.template_id
    FROM template_versions AS versions
    WHERE fields.template_version_id = versions.id
      AND fields.template_id IS NULL;

    DELETE FROM template_fields WHERE template_id IS NULL;

    ALTER TABLE template_fields DROP CONSTRAINT IF EXISTS template_fields_template_version_id_fkey;
    DROP INDEX IF EXISTS template_fields_order;
    ALTER TABLE template_fields DROP COLUMN template_version_id;
    ALTER TABLE template_fields ALTER COLUMN template_id SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'template_fields_template_id_fkey'
    ) THEN
      ALTER TABLE template_fields
        ADD CONSTRAINT template_fields_template_id_fkey
        FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE;
    END IF;
  END IF;

  DROP TABLE template_versions CASCADE;
END $$;

CREATE TABLE IF NOT EXISTS template_fields (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
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

ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS catalog_key TEXT;
ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'line';
ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS template_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'template_fields'
      AND column_name = 'template_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'template_fields_template_id_fkey'
  ) THEN
    ALTER TABLE template_fields
      ALTER COLUMN template_id SET NOT NULL;
    ALTER TABLE template_fields
      ADD CONSTRAINT template_fields_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS templates_one_active
  ON templates (is_active)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS template_fields_order
  ON template_fields (template_id, position);

CREATE INDEX IF NOT EXISTS template_fields_catalog_key
  ON template_fields (catalog_key)
  WHERE catalog_key IS NOT NULL;
