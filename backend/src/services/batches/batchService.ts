import { getActiveTemplate, getTemplate } from "../../db/templates/templateDb.js";
import { existingDocumentIds } from "../../db/documents/documentDb.js";
import { resolveDocumentType } from "../documents/documentType.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { hasClaudeCredentials } from "../extract/anthropicClient.js";
import { startStagedExtraction } from "./batchExtract.js";
import {
  STAGED_STATUSES,
  listStagedFiles,
  releaseUnextractedDocuments,
  readStagedFile,
  removeStagedFile,
  saveCompressedUpload,
  type StagedFile,
} from "./stagedStore.js";
import { gzipUpload, validateUploadFiles, type UploadedMemoryFile } from "./zipArchive.js";

const BUSY_MS = 2 * 60 * 1000;

export const stageUploads = async (input: {
  files: UploadedMemoryFile[];
  templateId?: string | null;
  deferTemplate?: boolean;
}): Promise<StagedFile[]> => {
  validateUploadFiles(input.files);
  const selected = input.templateId && !input.deferTemplate ? await getTemplate(input.templateId) : null;
  const active = selected || input.deferTemplate ? null : await getActiveTemplate();
  const templateId = selected?.numericId ?? active?.numericId ?? null;
  const staged: StagedFile[] = [];

  try {
    for (const file of input.files) {
      const compressed = await gzipUpload(file);
      const record = await saveCompressedUpload({
        fileName: compressed.originalName,
        mimeType: file.mimetype || "",
        documentType: resolveDocumentType("", compressed.originalName),
        templateId,
        fileData: compressed.fileData,
      });
      staged.push({ ...record, sizeBytes: compressed.sizeBytes });
    }
  } catch (error) {
    await Promise.all(staged.map((file) => removeStagedFile(file.id)));
    throw error;
  }

  return staged;
};

export const getStagedFile = async (id: string) => {
  const file = await readStagedFile(id);
  if (!file) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Compressed file not found.", { code: "NOT_FOUND" });
  }
  return file;
};

export const listCompressedFiles = async () => {
  const files = await listStagedFiles();
  const ids = files.flatMap((file) => (file.documentId == null ? [] : [file.documentId]));
  const live = await existingDocumentIds(ids);
  const orphans = files.filter(
    (file) =>
      file.documentId != null &&
      !live.has(file.documentId) &&
      file.status !== STAGED_STATUSES.UPLOADED &&
      file.status !== STAGED_STATUSES.PROCESSING,
  );
  if (!orphans.length) return files;
  await Promise.all(orphans.map((file) => removeStagedFile(file.id)));
  const gone = new Set(orphans.map((file) => file.id));
  return files.filter((file) => !gone.has(file.id));
};

export const discardStagedFile = async (id: string) => {
  const file = await readStagedFile(id);
  if (!file) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Compressed file not found.", { code: "NOT_FOUND" });
  }
  if (file.status === STAGED_STATUSES.PROCESSING) {
    const started = file.startedAt ? new Date(file.startedAt).getTime() : 0;
    if (started && Date.now() - started < BUSY_MS) {
      throw AppError(HTTP_STATUS.CONFLICT, "File is already processing.", { code: "FILE_BUSY" });
    }
  }
  await removeStagedFile(id);
};

const isFreshProcessing = (file: StagedFile) => {
  if (file.status !== STAGED_STATUSES.PROCESSING) return false;
  const started = file.startedAt ? new Date(file.startedAt).getTime() : 0;
  return Boolean(started) && Date.now() - started < BUSY_MS;
};

export const runStagedFile = async (id: string) => {
  if (!hasClaudeCredentials()) {
    throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
      code: "CLAUDE_NOT_CONFIGURED",
    });
  }
  const file = await getStagedFile(id);
  if (file.status === STAGED_STATUSES.COMPLETED) {
    throw AppError(HTTP_STATUS.CONFLICT, "File already extracted.", { code: "FILE_DONE" });
  }
  if (isFreshProcessing(file)) {
    throw AppError(HTTP_STATUS.CONFLICT, "File is already processing.", { code: "FILE_BUSY" });
  }
  const claimed = await startStagedExtraction(id);
  if (!claimed) {
    const latest = await getStagedFile(id);
    if (latest.status === STAGED_STATUSES.COMPLETED) {
      throw AppError(HTTP_STATUS.CONFLICT, "File already extracted.", { code: "FILE_DONE" });
    }
    throw AppError(HTTP_STATUS.CONFLICT, "File is already processing.", { code: "FILE_BUSY" });
  }
  return claimed;
};

export const recoverStagedFiles = async () => {
  await releaseUnextractedDocuments();
  return [];
};

export const publicStagedFile = (file: StagedFile) => ({
  id: file.id,
  originalName: file.originalName,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  templateId: file.templateId,
  status: file.status,
  documentId: file.documentId,
  errorMessage: file.errorMessage,
  createdAt: file.createdAt,
  startedAt: file.startedAt,
  completedAt: file.completedAt,
});
