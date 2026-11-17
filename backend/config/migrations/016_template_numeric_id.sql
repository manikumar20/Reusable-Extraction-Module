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
