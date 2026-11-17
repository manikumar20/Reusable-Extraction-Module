-- Remove schedule / BullMQ columns from extraction batches.
UPDATE extraction_batches
SET status = 'Failed',
    error_message = COALESCE(error_message, 'Schedule feature removed. Run extract again.')
WHERE status = 'Scheduled';

DROP INDEX IF EXISTS extraction_batches_status;

ALTER TABLE extraction_batches
  DROP COLUMN IF EXISTS scheduled_at,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS bullmq_job_id,
  DROP COLUMN IF EXISTS extraction_mode;

CREATE INDEX IF NOT EXISTS extraction_batches_status
  ON extraction_batches (status);
