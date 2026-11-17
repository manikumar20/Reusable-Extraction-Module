import { randomUUID } from "node:crypto";
import { getPool } from "../_shared/client.js";

export const BATCH_STATUSES = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
} as const;

export type BatchStatus = (typeof BATCH_STATUSES)[keyof typeof BATCH_STATUSES];

export type ExtractionBatch = {
  id: string;
  jobName: string;
  zipFilePath: string;
  zipFileName: string;
  zipSizeBytes: number;
  fileCount: number;
  templateId: number | null;
  status: BatchStatus;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  fileNames?: string[];
  templateName?: string | null;
};

export type ExtractionBatchFile = {
  id: string;
  batchId: string;
  originalName: string;
  documentId: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

type BatchRow = {
  id: string;
  job_name: string;
  zip_file_path: string;
  zip_file_name: string;
  zip_size_bytes: string | number;
  file_count: number;
  template_id: number | string | null;
  status: string;
  retry_count: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
  file_names?: unknown;
  template_name?: string | null;
};

type FileRow = {
  id: string;
  batch_id: string;
  original_name: string;
  document_id: number | null;
  status: string;
  error_message: string | null;
  created_at: Date;
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const fileNameList = (value: unknown) => {
  const rows = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(rows)) return [];
  return rows.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
};

const mapBatch = (row: BatchRow): ExtractionBatch => ({
  id: row.id,
  jobName: row.job_name,
  zipFilePath: row.zip_file_path,
  zipFileName: row.zip_file_name,
  zipSizeBytes: Number(row.zip_size_bytes) || 0,
  fileCount: Number(row.file_count) || 0,
  templateId: row.template_id == null || row.template_id === "" ? null : Number(row.template_id),
  status: row.status as BatchStatus,
  retryCount: Number(row.retry_count) || 0,
  createdAt: row.created_at.toISOString(),
  startedAt: iso(row.started_at),
  completedAt: iso(row.completed_at),
  errorMessage: row.error_message,
  fileNames: fileNameList(row.file_names),
  templateName: row.template_name ?? null,
});

const mapFile = (row: FileRow): ExtractionBatchFile => ({
  id: row.id,
  batchId: row.batch_id,
  originalName: row.original_name,
  documentId: row.document_id == null ? null : Number(row.document_id),
  status: row.status,
  errorMessage: row.error_message,
  createdAt: row.created_at.toISOString(),
});

export const createBatch = async (input: {
  id: string;
  jobName: string;
  zipFilePath: string;
  zipFileName: string;
  zipSizeBytes: number;
  fileCount: number;
  templateId?: number | null;
  status: BatchStatus;
  originalNames: string[];
}): Promise<ExtractionBatch> => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<BatchRow>(
      `
        INSERT INTO extraction_batches (
          id, job_name, zip_file_path, zip_file_name, zip_size_bytes, file_count,
          template_id, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `,
      [
        input.id,
        input.jobName,
        input.zipFilePath,
        input.zipFileName,
        input.zipSizeBytes,
        input.fileCount,
        input.templateId ?? null,
        input.status,
      ],
    );
    for (const name of input.originalNames) {
      await client.query(
        `
          INSERT INTO extraction_batch_files (id, batch_id, original_name, status)
          VALUES ($1, $2, $3, $4)
        `,
        [randomUUID(), input.id, name, "Pending"],
      );
    }
    await client.query("COMMIT");
    return mapBatch(rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const getBatch = async (id: string): Promise<ExtractionBatch | null> => {
  const { rows } = await getPool().query<BatchRow>(
    `SELECT * FROM extraction_batches WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? mapBatch(rows[0]) : null;
};

export const listBatches = async (): Promise<ExtractionBatch[]> => {
  const { rows } = await getPool().query<BatchRow>(
    `
      SELECT b.*,
             t.name AS template_name,
             COALESCE(
               (
                 SELECT json_agg(f.original_name ORDER BY f.created_at)
                 FROM extraction_batch_files f
                 WHERE f.batch_id = b.id
               ),
               '[]'::json
             ) AS file_names
      FROM extraction_batches b
      LEFT JOIN templates t ON t.numeric_id = b.template_id
      ORDER BY b.created_at DESC
      LIMIT 100
    `,
  );
  return rows.map(mapBatch);
};

export const listBatchFiles = async (batchId: string): Promise<ExtractionBatchFile[]> => {
  const { rows } = await getPool().query<FileRow>(
    `
      SELECT * FROM extraction_batch_files
      WHERE batch_id = $1
      ORDER BY created_at ASC
    `,
    [batchId],
  );
  return rows.map(mapFile);
};

export const updateBatchStatus = async (
  id: string,
  patch: {
    status?: BatchStatus;
    startedAt?: Date | null;
    completedAt?: Date | null;
    errorMessage?: string | null;
    retryCount?: number;
    templateId?: number | null;
  },
): Promise<ExtractionBatch | null> => {
  const { rows } = await getPool().query<BatchRow>(
    `
      UPDATE extraction_batches
      SET status = COALESCE($2, status),
          started_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE started_at END,
          completed_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE completed_at END,
          error_message = CASE WHEN $7::boolean THEN $8 ELSE error_message END,
          retry_count = COALESCE($9, retry_count),
          template_id = CASE WHEN $10::boolean THEN $11 ELSE template_id END
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      patch.status ?? null,
      patch.startedAt !== undefined,
      patch.startedAt ?? null,
      patch.completedAt !== undefined,
      patch.completedAt ?? null,
      patch.errorMessage !== undefined,
      patch.errorMessage ?? null,
      patch.retryCount ?? null,
      patch.templateId !== undefined,
      patch.templateId ?? null,
    ],
  );
  return rows[0] ? mapBatch(rows[0]) : null;
};

export const updateBatchFile = async (
  batchId: string,
  originalName: string,
  patch: { status: string; documentId?: number | null; errorMessage?: string | null },
) => {
  await getPool().query(
    `
      UPDATE extraction_batch_files
      SET status = $3,
          document_id = COALESCE($4, document_id),
          error_message = $5
      WHERE batch_id = $1 AND original_name = $2
    `,
    [batchId, originalName, patch.status, patch.documentId ?? null, patch.errorMessage ?? null],
  );
};

export const claimBatchForProcessing = async (id: string): Promise<ExtractionBatch | null> => {
  const { rows } = await getPool().query<BatchRow>(
    `
      UPDATE extraction_batches
      SET status = $2,
          started_at = NOW(),
          error_message = NULL
      WHERE id = $1
        AND (
          status = $3
          OR (
            status = $2
            AND (started_at IS NULL OR started_at < NOW() - INTERVAL '2 minutes')
          )
        )
      RETURNING *
    `,
    [id, BATCH_STATUSES.PROCESSING, BATCH_STATUSES.UPLOADED],
  );
  return rows[0] ? mapBatch(rows[0]) : null;
};

/** A restart kills any in-flight worker, so every Processing row is orphaned. */
export const recoverStaleProcessingBatches = async (): Promise<string[]> => {
  const { rows } = await getPool().query<{ id: string }>(
    `
      UPDATE extraction_batches
      SET status = $1,
          started_at = NULL,
          completed_at = NULL,
          error_message = NULL
      WHERE status = $2
      RETURNING id
    `,
    [BATCH_STATUSES.UPLOADED, BATCH_STATUSES.PROCESSING],
  );
  if (rows.length) {
    console.warn(`Re-queued ${rows.length} interrupted extraction batch(es).`);
  }
  // Clear any leftover Scheduled rows from the removed schedule feature.
  await getPool().query(
    `
      UPDATE extraction_batches
      SET status = $1,
          error_message = COALESCE(error_message, 'Schedule feature removed. Run extract again.')
      WHERE status = 'Scheduled'
    `,
    [BATCH_STATUSES.FAILED],
  );
  return rows.map((row) => row.id);
};
