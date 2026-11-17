-- ZIP-based multi-file extraction batches.
CREATE TABLE IF NOT EXISTS extraction_batches (
  id UUID PRIMARY KEY,
  job_name TEXT NOT NULL,
  zip_file_path TEXT NOT NULL,
  zip_file_name TEXT NOT NULL,
  zip_size_bytes BIGINT NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  template_id INTEGER,
  status TEXT NOT NULL DEFAULT 'Uploaded',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS extraction_batches_status
  ON extraction_batches (status);

CREATE INDEX IF NOT EXISTS extraction_batches_created
  ON extraction_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS extraction_batch_files (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES extraction_batches (id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  document_id INTEGER REFERENCES documents (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS extraction_batch_files_batch
  ON extraction_batch_files (batch_id, created_at ASC);
