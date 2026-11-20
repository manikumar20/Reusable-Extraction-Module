import { gunzipSync } from "node:zlib";
import { deleteDocument, insertExtractedDocument, saveExtractedFields } from "../../db/documents/documentDb.js";
import { getActiveTemplate, getTemplate, toJobTemplate } from "../../db/templates/templateDb.js";
import { ExtractionError, extractDocument } from "../extract/engine/extract/run.js";
import { lineIdentityValue, type ExtractedLine } from "../extract/engine/extract/records.js";
import { lineExtrasFromTemplate, type JobTemplate } from "../extract/extractService.js";
import { apiKey, recordModel } from "../../config/runtime.js";
import {
  STAGED_STATUSES,
  claimStagedFile,
  compressedGzipFor,
  dropTemporaryGzip,
  heldDocumentType,
  readStagedFile,
  updateStagedFile,
  type StagedFile,
} from "./stagedStore.js";

const mergeLines = (current: ExtractedLine[], batch: ExtractedLine[]) => {
  const lines = [...current];
  for (const item of batch) {
    const number = lineIdentityValue(item);
    const index = lines.findIndex((line) =>
      number
        ? lineIdentityValue(line) === number
        : JSON.stringify(line.fields) === JSON.stringify(item.fields),
    );
    if (number && index >= 0) lines[index] = item;
    else if (index < 0) lines.push(item);
  }
  return lines;
};

const resolveTemplate = async (templateId: number | null): Promise<JobTemplate | null> => {
  if (templateId != null) {
    const saved = await getTemplate(String(templateId));
    if (saved) return toJobTemplate(saved);
  }
  const active = await getActiveTemplate();
  return active ? toJobTemplate(active) : null;
};

const numericTemplateId = async (templateId: number | null) => {
  if (templateId != null) return templateId;
  const active = await getActiveTemplate();
  return active?.numericId ?? null;
};

const extractClaimedFile = async (claimed: StagedFile): Promise<StagedFile | null> => {
  const templateNumericId = await numericTemplateId(claimed.templateId);
  const template = await resolveTemplate(templateNumericId);
  const lineExtras = await lineExtrasFromTemplate(template);
  let plain: Buffer | null = null;

  try {
    const gzip = await compressedGzipFor(claimed.id);
    if (!gzip) {
      throw new Error("Temporary compressed file is missing. Upload the file again.");
    }
    plain = gunzipSync(gzip);
    const fileName = claimed.originalName;

    if (claimed.templateId !== templateNumericId) {
      await updateStagedFile(claimed.id, { templateId: templateNumericId });
    }

    let lines: ExtractedLine[] = [];
    await extractDocument({
      filePath: fileName,
      fileBuffer: plain,
      fileName,
      apiKey: apiKey(),
      recordModel: recordModel(),
      lineKeys: template?.lineKeys,
      lineExtras,
      onRecords: (records) => {
        lines = mergeLines(lines, records);
      },
    });

    const created = await insertExtractedDocument({
      fileName,
      mimeType: claimed.mimeType,
      documentType: heldDocumentType(claimed.id),
      templateId: templateNumericId,
      fileData: gzip,
    });
    try {
      await saveExtractedFields({ documentId: created.id, lines });
    } catch (error) {
      await deleteDocument(created.id).catch(() => undefined);
      throw error;
    }
    dropTemporaryGzip(claimed.id);
    return await updateStagedFile(claimed.id, {
      status: STAGED_STATUSES.COMPLETED,
      documentId: created.id,
      templateId: templateNumericId,
      completedAt: new Date().toISOString(),
      errorMessage: null,
    });
  } catch (error) {
    const message =
      error instanceof ExtractionError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Extraction failed.";
    return await updateStagedFile(claimed.id, {
      status: STAGED_STATUSES.FAILED,
      completedAt: new Date().toISOString(),
      errorMessage: message,
    });
  } finally {
    plain?.fill(0);
  }
};

/** Decompress the temporary gzip, extract, discard the plain bytes, then store the gzip. */
export const processStagedExtraction = async (id: string): Promise<StagedFile | null> => {
  const claimed = await claimStagedFile(id);
  if (!claimed) return readStagedFile(id);
  return extractClaimedFile(claimed);
};

/** Mark the file Processing and extract it. The returned record is already claimed. */
export const startStagedExtraction = async (id: string): Promise<StagedFile | null> => {
  const claimed = await claimStagedFile(id);
  if (!claimed) return null;
  void extractClaimedFile(claimed).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Staged file ${id} failed:`, message);
    await updateStagedFile(id, {
      status: STAGED_STATUSES.FAILED,
      completedAt: new Date().toISOString(),
      errorMessage: message,
    }).catch(() => undefined);
  });
  return claimed;
};
