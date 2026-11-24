-- Template samples keep field names only. Drop stored sample values.
UPDATE template_documents
SET extracted_fields = (
  SELECT COALESCE(jsonb_agg(elem - 'sampleValue'), '[]'::jsonb)
  FROM jsonb_array_elements(extracted_fields) AS elem
)
WHERE jsonb_typeof(extracted_fields) = 'array'
  AND extracted_fields::text LIKE '%sampleValue%';
