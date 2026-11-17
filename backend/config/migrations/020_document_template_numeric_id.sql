-- Store template references on documents/batches as templates.numeric_id (INTEGER).

-- template_documents.template_id: UUID → INTEGER (numeric_id)
ALTER TABLE template_documents DROP CONSTRAINT IF EXISTS template_documents_template_id_fkey;

ALTER TABLE template_documents ADD COLUMN IF NOT EXISTS template_numeric_id INTEGER;

UPDATE template_documents td
SET template_numeric_id = t.numeric_id
FROM templates t
WHERE td.template_numeric_id IS NULL
  AND t.id = td.template_id;

DELETE FROM template_documents WHERE template_numeric_id IS NULL;

ALTER TABLE template_documents DROP COLUMN IF EXISTS template_id;
ALTER TABLE template_documents RENAME COLUMN template_numeric_id TO template_id;
ALTER TABLE template_documents ALTER COLUMN template_id SET NOT NULL;

ALTER TABLE template_documents
  ADD CONSTRAINT template_documents_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates (numeric_id) ON DELETE CASCADE;

DROP INDEX IF EXISTS template_documents_template;
CREATE INDEX IF NOT EXISTS template_documents_template
  ON template_documents (template_id, created_at ASC);

-- extraction_batches.template_id: UUID → INTEGER (numeric_id)
ALTER TABLE extraction_batches DROP CONSTRAINT IF EXISTS extraction_batches_template_id_fkey;

ALTER TABLE extraction_batches ADD COLUMN IF NOT EXISTS template_numeric_id INTEGER;

UPDATE extraction_batches b
SET template_numeric_id = t.numeric_id
FROM templates t
WHERE b.template_numeric_id IS NULL
  AND b.template_id IS NOT NULL
  AND t.id = b.template_id;

ALTER TABLE extraction_batches DROP COLUMN IF EXISTS template_id;
ALTER TABLE extraction_batches RENAME COLUMN template_numeric_id TO template_id;

ALTER TABLE extraction_batches
  ADD CONSTRAINT extraction_batches_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates (numeric_id) ON DELETE SET NULL;
