-- Collapse template version history to one mutable row per template.
-- Older versions (and their fields via CASCADE) are removed.

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
