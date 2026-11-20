import { gunzipSync } from "node:zlib";
import { getCompressedDocument } from "../../db/documents/documentDb.js";
import { getPool } from "../../db/_shared/client.js";

export const STAGED_STATUSES = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
} as const;

export type StagedStatus = (typeof STAGED_STATUSES)[keyof typeof STAGED_STATUSES];

export type StagedFile = {
  id: string;
  originalName: string;
  mimeType: string;
  archivePath: string;
  sizeBytes: number;
  templateId: number | null;
  status: StagedStatus;
  documentId: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type DocumentFileRow = {
  id: number;
  file_name: string;
  mime_type: string;
  template_id: number | null;
  status: string;
  error_message: string | null;
  uploaded_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  size_bytes: string | number | null;
};

type HeldUpload = {
  record: StagedFile;
  documentType: string;
  gzip: Buffer | null;
};

/** Compressed uploads stay here until extraction finishes. They are not database rows yet. */
const pending = new Map<string, HeldUpload>();

const allocTempId = () => `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;

export const temporaryGzipFor = (id: string) => pending.get(id)?.gzip ?? null;

export const dropTemporaryGzip = (id: string) => {
  const held = pending.get(id);
  if (held) held.gzip = null;
};

export const heldDocumentType = (id: string) => pending.get(id)?.documentType ?? "";

const locks = new Map<string, Promise<void>>();

const withLock = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  const previous = locks.get(id) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  locks.set(id, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === tail) locks.delete(id);
  }
};

const iso = (value: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const asStatus = (value: string): StagedStatus => {
  if (value === "Processing" || value === "Completed" || value === "Failed" || value === "Uploaded") {
    return value;
  }
  return "Uploaded";
};

const toStaged = (row: DocumentFileRow): StagedFile => ({
  id: String(row.id),
  originalName: row.file_name,
  mimeType: row.mime_type || "",
  archivePath: "",
  sizeBytes: Number(row.size_bytes ?? 0),
  templateId: row.template_id == null ? null : Number(row.template_id),
  status: asStatus(row.status),
  documentId: Number(row.id),
  errorMessage: row.error_message,
  createdAt: iso(row.uploaded_at) || new Date().toISOString(),
  startedAt: iso(row.started_at),
  completedAt: iso(row.completed_at),
});

const FILE_COLUMNS = `
  id, file_name, mime_type, template_id, status, error_message,
  uploaded_at, started_at, completed_at, octet_length(file_data)::text AS size_bytes
`;

export const saveCompressedUpload = async (input: {
  fileName: string;
  mimeType: string;
  documentType: string;
  templateId: number | null;
  fileData: Buffer;
}) => {
  const id = allocTempId();
  const record: StagedFile = {
    id,
    originalName: input.fileName,
    mimeType: input.mimeType,
    archivePath: "",
    sizeBytes: input.fileData.length,
    templateId: input.templateId,
    status: STAGED_STATUSES.UPLOADED,
    documentId: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
  };
  pending.set(id, { record, documentType: input.documentType, gzip: input.fileData });
  return record;
};

/** Compressed bytes from the temporary hold, or from the database after extraction. */
export const compressedGzipFor = async (id: string) => {
  const held = temporaryGzipFor(id);
  if (held) return held;
  const documentId = Number(id);
  if (!Number.isInteger(documentId) || documentId <= 0) return null;
  return getCompressedDocument(documentId);
};

export const readCompressedBytes = async (id: string) => {
  const gzip = await compressedGzipFor(id);
  if (!gzip) return null;
  return gunzipSync(gzip);
};

export const readStagedFile = async (id: string): Promise<StagedFile | null> => {
  const held = pending.get(id);
  if (held) return held.record;
  const documentId = Number(id);
  if (!Number.isInteger(documentId) || documentId <= 0) return null;
  const { rows } = await getPool().query<DocumentFileRow>(
    `SELECT ${FILE_COLUMNS} FROM documents WHERE id = $1 AND status = 'Completed'`,
    [documentId],
  );
  return rows[0] ? toStaged(rows[0]) : null;
};

export const listStagedFiles = async (): Promise<StagedFile[]> => [...pending.values()].map((held) => held.record);

export const updateStagedFile = async (
  id: string,
  patch: Partial<Omit<StagedFile, "id">>,
): Promise<StagedFile | null> =>
  withLock(id, async () => {
    const held = pending.get(id);
    if (!held) return readStagedFile(id);
    held.record = { ...held.record, ...patch, id };
    return held.record;
  });

/** Claim a document for extraction. Returns null when another worker owns a fresh claim. */
export const claimStagedFile = async (id: string): Promise<StagedFile | null> =>
  withLock(id, async () => {
    const current = await readStagedFile(id);
    if (!current) return null;
    if (current.status === STAGED_STATUSES.COMPLETED) return null;
    if (current.status === STAGED_STATUSES.PROCESSING) {
      const started = current.startedAt ? new Date(current.startedAt).getTime() : 0;
      const fresh = started > 0 && Date.now() - started < 2 * 60 * 1000;
      if (fresh) return null;
    }
    const held = pending.get(id);
    if (!held) return null;
    held.record = {
      ...held.record,
      status: STAGED_STATUSES.PROCESSING,
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
    };
    return held.record;
  });

export const removeStagedFile = async (id: string) => {
  const held = pending.get(id);
  if (!held) return;
  if (held.record.status === STAGED_STATUSES.COMPLETED) return;
  pending.delete(id);
};

/** Move files that were saved before extraction back out of the database. */
export const releaseUnextractedDocuments = async () => {
  const { rows } = await getPool().query<{
    id: number;
    file_name: string;
    mime_type: string;
    document_type: string;
    template_id: number | null;
    status: string;
    error_message: string | null;
    uploaded_at: Date;
    file_data: Buffer | null;
  }>(
    `
      SELECT id, file_name, mime_type, document_type, template_id, status, error_message, uploaded_at, file_data
      FROM documents
      WHERE in_library = FALSE AND status <> 'Completed'
    `,
  );
  for (const row of rows) {
    if (row.file_data?.length) {
      const id = String(row.id);
      pending.set(id, {
        documentType: row.document_type || "",
        gzip: row.file_data,
        record: {
          id,
          originalName: row.file_name,
          mimeType: row.mime_type || "",
          archivePath: "",
          sizeBytes: row.file_data.length,
          templateId: row.template_id == null ? null : Number(row.template_id),
          status: row.status === "Failed" ? STAGED_STATUSES.FAILED : STAGED_STATUSES.UPLOADED,
          documentId: null,
          errorMessage: row.status === "Failed" ? row.error_message : null,
          createdAt: iso(row.uploaded_at) || new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      });
    }
  }
  if (rows.length) {
    await getPool().query(
      `DELETE FROM documents WHERE in_library = FALSE AND status <> 'Completed'`,
    );
  }
};

/** The compressed file is the document row, so deleting the document already removes it. */
export const removeStagedFilesForDocument = async (_documentId: number) => undefined;
