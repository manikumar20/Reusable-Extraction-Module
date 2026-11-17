-- One row per template (no version history table).
-- Column order: id, numeric_id, name, is_active, published, created_at, updated_at
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY,
  numeric_id INTEGER,
  name TEXT NOT NULL,
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

  INSERT INTO templates (id, name, is_active, created_at, updated_at)
  SELECT DISTINCT ON (template_id)
    template_id,
    name,
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

ALTER TABLE templates ADD COLUMN IF NOT EXISTS numeric_id INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM templates WHERE numeric_id IS NULL) THEN
    WITH numbered AS (
      SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1)::int AS n
      FROM templates
      WHERE numeric_id IS NULL
    ),
    base AS (
      SELECT COALESCE(MAX(numeric_id) + 1, 0) AS start_at FROM templates
    )
    UPDATE templates AS t
    SET numeric_id = numbered.n + base.start_at
    FROM numbered, base
    WHERE t.id = numbered.id;
  END IF;
END $$;

ALTER TABLE templates ALTER COLUMN numeric_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS templates_numeric_id_unique ON templates (numeric_id);

CREATE SEQUENCE IF NOT EXISTS templates_numeric_id_seq AS INTEGER MINVALUE 0 START WITH 0;

SELECT setval(
  'templates_numeric_id_seq',
  GREATEST(COALESCE((SELECT MAX(numeric_id) FROM templates), 0), 0),
  EXISTS (SELECT 1 FROM templates)
);

ALTER TABLE templates ALTER COLUMN numeric_id SET DEFAULT nextval('templates_numeric_id_seq');
ALTER SEQUENCE templates_numeric_id_seq OWNED BY templates.numeric_id;
