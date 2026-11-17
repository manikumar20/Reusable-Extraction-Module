import path from "node:path";
import {
  BATCH_STATUSES,
  createBatch,
  getBatch,
  listBatchFiles,
  listBatches,
  recoverStaleProcessingBatches,
  updateBatchStatus,
  type ExtractionBatch,
} from "../../db/batches/batchDb.js";
import { getActiveTemplate, getTemplate } from "../../db/templates/templateDb.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { hasClaudeCredentials } from "../extract/anthropicClient.js";
import { processBatchExtraction } from "./batchExtract.js";
import { compressUploadsToZip, type UploadedDiskFile } from "./zipArchive.js";

export const createBatchFromUploads = async (input: {
  files: UploadedDiskFile[];
  jobName?: string;
  templateId?: string | null;
}): Promise<ExtractionBatch> => {
  const zip = await compressUploadsToZip(input.files);
  const selected = input.templateId ? await getTemplate(input.templateId) : null;
  const active = selected ? null : await getActiveTemplate();
  const templateId = selected?.numericId ?? active?.numericId ?? null;
  return createBatch({
    id: zip.batchId,
    jobName: input.jobName?.trim() || `Batch ${new Date().toISOString().slice(0, 16)}`,
    zipFilePath: zip.zipFilePath,
    zipFileName: zip.zipFileName,
    zipSizeBytes: zip.zipSizeBytes,
    fileCount: zip.originalNames.length,
    templateId,
    status: BATCH_STATUSES.UPLOADED,
    originalNames: zip.originalNames,
  });
};

export const getBatchDetail = async (id: string) => {
  const batch = await getBatch(id);
  if (!batch) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Extraction batch not found.", { code: "NOT_FOUND" });
  }
  const files = await listBatchFiles(id);
  return { batch, files };
};

export const listExtractionBatches = () => listBatches();

export const recoverStaleBatches = async () => {
  const ids = await recoverStaleProcessingBatches();
  for (const id of ids) {
    void processBatchExtraction(id).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Batch ${id} failed after restart:`, message);
      await updateBatchStatus(id, {
        status: BATCH_STATUSES.FAILED,
        completedAt: new Date(),
        errorMessage: message,
      }).catch(() => undefined);
    });
  }
  return ids;
};

export const runBatchNow = async (id: string) => {
  if (!hasClaudeCredentials()) {
    throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
      code: "CLAUDE_NOT_CONFIGURED",
    });
  }
  const batch = await getBatch(id);
  if (!batch) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Extraction batch not found.", { code: "NOT_FOUND" });
  }
  if (batch.status === BATCH_STATUSES.CANCELLED) {
    throw AppError(HTTP_STATUS.CONFLICT, "Cancelled batches cannot be run.", {
      code: "BATCH_CANCELLED",
    });
  }
  if (batch.status === BATCH_STATUSES.COMPLETED) {
    throw AppError(HTTP_STATUS.CONFLICT, "Batch already completed.", { code: "BATCH_DONE" });
  }
  if (batch.status === BATCH_STATUSES.PROCESSING) {
    const started = batch.startedAt ? new Date(batch.startedAt).getTime() : 0;
    const stale = !started || Date.now() - started > 2 * 60 * 1000;
    if (!stale) {
      throw AppError(HTTP_STATUS.CONFLICT, "Batch is already processing.", { code: "BATCH_BUSY" });
    }
  }
  if (batch.status === BATCH_STATUSES.PROCESSING || batch.status === BATCH_STATUSES.FAILED) {
    await updateBatchStatus(id, {
      status: BATCH_STATUSES.UPLOADED,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
    });
  }

  void processBatchExtraction(id).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Batch ${id} failed:`, message);
    await updateBatchStatus(id, {
      status: BATCH_STATUSES.FAILED,
      completedAt: new Date(),
      errorMessage: message,
    }).catch(() => undefined);
  });
  return getBatchDetail(id);
};

export const publicBatch = (batch: ExtractionBatch) => ({
  id: batch.id,
  jobName: batch.jobName,
  zipFileName: batch.zipFileName,
  zipSizeBytes: batch.zipSizeBytes,
  fileCount: batch.fileCount,
  templateId: batch.templateId,
  status: batch.status,
  retryCount: batch.retryCount,
  createdAt: batch.createdAt,
  startedAt: batch.startedAt,
  completedAt: batch.completedAt,
  errorMessage: batch.errorMessage,
  zipStoredAs: path.basename(batch.zipFilePath),
  fileNames: batch.fileNames ?? [],
  templateName: batch.templateName ?? null,
});
