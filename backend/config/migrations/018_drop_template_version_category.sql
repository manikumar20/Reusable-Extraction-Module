-- Remove unused template version and category columns.
ALTER TABLE templates
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS category;
