CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS templates_one_active
  ON templates (is_active)
  WHERE is_active;

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

  IF EXISTS (
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

    CREATE INDEX IF NOT EXISTS template_fields_order
      ON template_fields (template_id, position);
  END IF;

  DROP TABLE template_versions CASCADE;
END $$;

ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS catalog_key TEXT;
ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'line';

CREATE INDEX IF NOT EXISTS template_fields_catalog_key
  ON template_fields (catalog_key)
  WHERE catalog_key IS NOT NULL;
