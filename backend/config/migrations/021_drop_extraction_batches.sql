-- Keep the template used for a document, then drop batch tables.
-- Uploads are individual temporary .7z files, not database rows.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS template_id INTEGER;

CREATE INDEX IF NOT EXISTS documents_template_id
  ON documents (template_id);

DO $$
BEGIN
  IF to_regclass('public.extraction_batch_files') IS NULL
     OR to_regclass('public.extraction_batches') IS NULL THEN
    RETURN;
  END IF;

  UPDATE documents d
  SET template_id = picked.template_id
  FROM (
    SELECT DISTINCT ON (bf.document_id)
      bf.document_id,
      b.template_id
    FROM extraction_batch_files bf
    JOIN extraction_batches b ON b.id = bf.batch_id
    WHERE bf.document_id IS NOT NULL
      AND b.template_id IS NOT NULL
    ORDER BY bf.document_id, bf.created_at DESC
  ) picked
  WHERE d.id = picked.document_id
    AND d.template_id IS NULL;
END $$;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_template_id_fkey;
ALTER TABLE documents
  ADD CONSTRAINT documents_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates (numeric_id) ON DELETE SET NULL;

DROP TABLE IF EXISTS extraction_batch_files;
DROP TABLE IF EXISTS extraction_batches;
