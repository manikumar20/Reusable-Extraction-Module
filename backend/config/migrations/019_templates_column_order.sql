-- Reorder templates columns to:
-- id, numeric_id, name, is_active, published, created_at, updated_at

CREATE TABLE IF NOT EXISTS templates_reordered (
  id UUID PRIMARY KEY,
  numeric_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO templates_reordered (id, numeric_id, name, is_active, published, created_at, updated_at)
SELECT id, numeric_id, name, is_active, COALESCE(published, TRUE), created_at, updated_at
FROM templates
ON CONFLICT (id) DO NOTHING;

-- Drop foreign keys that reference templates.
ALTER TABLE template_fields DROP CONSTRAINT IF EXISTS template_fields_template_id_fkey;
ALTER TABLE template_documents DROP CONSTRAINT IF EXISTS template_documents_template_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'extraction_batches'
  ) THEN
    ALTER TABLE extraction_batches DROP CONSTRAINT IF EXISTS extraction_batches_template_id_fkey;
  END IF;
END $$;

DROP TABLE templates CASCADE;
ALTER TABLE templates_reordered RENAME TO templates;

-- Restore sequence / default for numeric_id.
CREATE SEQUENCE IF NOT EXISTS templates_numeric_id_seq AS INTEGER MINVALUE 0 START WITH 0;
SELECT setval(
  'templates_numeric_id_seq',
  GREATEST(COALESCE((SELECT MAX(numeric_id) FROM templates), 0), 0),
  EXISTS (SELECT 1 FROM templates)
);
ALTER TABLE templates ALTER COLUMN numeric_id SET DEFAULT nextval('templates_numeric_id_seq');
ALTER SEQUENCE templates_numeric_id_seq OWNED BY templates.numeric_id;

CREATE UNIQUE INDEX IF NOT EXISTS templates_numeric_id_unique ON templates (numeric_id);
CREATE UNIQUE INDEX IF NOT EXISTS templates_one_active ON templates (is_active) WHERE is_active;

-- Restore foreign keys.
ALTER TABLE template_fields
  ADD CONSTRAINT template_fields_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE;

ALTER TABLE template_documents
  ADD CONSTRAINT template_documents_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'extraction_batches'
      AND column_name = 'template_id'
  ) THEN
    ALTER TABLE extraction_batches
      ADD CONSTRAINT extraction_batches_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
