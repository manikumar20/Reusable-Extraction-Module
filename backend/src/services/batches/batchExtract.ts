import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { insertDocument, saveExtractedFields, updateDocumentStatus } from "../../db/documents/documentDb.js";
import {
  BATCH_STATUSES,
  claimBatchForProcessing,
  getBatch,
  updateBatchFile,
  updateBatchStatus,
} from "../../db/batches/batchDb.js";
import { getActiveTemplate, getTemplate, toJobTemplate } from "../../db/templates/templateDb.js";
import { uploadDir } from "../../middleware/documentUpload.js";
import { resolveDocumentType } from "../documents/documentType.js";
import {
  ExtractionError,
  extractDocument,
} from "../extract/engine/extract/run.js";
import {
  lineIdentityValue,
  type ExtractedLine,
} from "../extract/engine/extract/records.js";
import {
  FIELD_DATA_TYPES,
  HEADER_FIELDS,
  LINE_FIELDS,
  type CatalogField,
} from "../extract/engine/shared/fields.js";
import type { JobTemplate } from "../extract/extractService.js";
import { apiKey, documentModel, recordModel } from "../../config/runtime.js";
import { forEachZipEntry } from "./zipArchive.js";

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

const mimeFromName = (fileName: string) => {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
};

const typeFromTemplate = (value: string): CatalogField["dataType"] => {
  if (value === "date") return FIELD_DATA_TYPES.DATE;
  if (value === "number" || value === "currency") return FIELD_DATA_TYPES.NUMBER;
  if (value === "table") return FIELD_DATA_TYPES.LIST;
  return FIELD_DATA_TYPES.TEXT;
};

const slugKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const schemaFromTemplate = async (template: JobTemplate | null) => {
  if (!template?.id) return undefined;
  const saved = await getTemplate(template.id);
  if (!saved) return undefined;
  const headerByKey = new Map(HEADER_FIELDS.map((field) => [field.key, field]));
  const lineByKey = new Map(LINE_FIELDS.map((field) => [field.key, field]));
  const headerFields: CatalogField[] = [];
  const lineExtras: CatalogField[] = [];
  for (const field of saved.fields) {
    const key = field.catalogKey?.trim() || slugKey(field.name);
    if (!key) continue;
    const lineCatalog = lineByKey.get(key);
    if (field.level !== "header" && lineCatalog) {
      if (!lineCatalog.isDefault) lineExtras.push(lineCatalog);
      continue;
    }
    const headerCatalog = headerByKey.get(key);
    if (headerCatalog) {
      headerFields.push(headerCatalog);
      continue;
    }
    headerFields.push({
      key,
      label: field.name.trim() || key,
      dataType: typeFromTemplate(field.type),
      description: field.hint || field.validation || field.name,
    });
  }
  return { headerFields, lineExtras };
};

const resolveTemplate = async (templateId: number | null): Promise<JobTemplate | null> => {
  if (templateId != null) {
    const saved = await getTemplate(String(templateId));
    if (saved) return toJobTemplate(saved);
  }
  const active = await getActiveTemplate();
  return active ? toJobTemplate(active) : null;
};

/** Run extraction for every supported file inside the batch ZIP using the existing engine. */
export const processBatchExtraction = async (batchId: string) => {
  const claimed = await claimBatchForProcessing(batchId);
  if (!claimed) {
    const current = await getBatch(batchId);
    if (!current) throw new Error("Batch not found.");
    if (current.status === BATCH_STATUSES.COMPLETED) {
      return current;
    }
    if (current.status === BATCH_STATUSES.PROCESSING) {
      // Another worker owns a fresh Processing claim — do not treat as done.
      return current;
    }
    throw new Error(`Batch cannot be processed from status ${current.status}.`);
  }

  const template = await resolveTemplate(claimed.templateId);
  const schema = await schemaFromTemplate(template);
  let failures = 0;

  try {
    await forEachZipEntry(claimed.zipFilePath, async (entry) => {
      const storedName = `${randomUUID()}-${entry.originalName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}`;
      const storedPath = path.join(uploadDir, storedName);
      await fs.copyFile(entry.tempPath, storedPath);

      let documentId: number | null = null;
      try {
        const document = await insertDocument({
          fileName: entry.originalName,
          storedName,
          mimeType: mimeFromName(entry.originalName),
          documentType: resolveDocumentType("", entry.originalName),
        });
        documentId = document.id;

        let lines: ExtractedLine[] = [];
        const result = await extractDocument({
          filePath: storedPath,
          fileName: entry.originalName,
          apiKey: apiKey(),
          recordModel: recordModel(),
          documentModel: documentModel(),
          headerKeys: template?.headerKeys,
          lineKeys: template?.lineKeys,
          headerFields: schema?.headerFields,
          lineExtras: schema?.lineExtras,
          onRecords: (records) => {
            lines = mergeLines(lines, records);
          },
        });

        await saveExtractedFields({
          documentId,
          header: result.header,
          lines,
        });
        await updateDocumentStatus(documentId, "Completed").catch(() => undefined);

        await updateBatchFile(batchId, entry.originalName, {
          status: "Completed",
          documentId,
          errorMessage: null,
        });
      } catch (error) {
        failures += 1;
        const message =
          error instanceof ExtractionError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Extraction failed.";
        if (documentId != null) {
          await updateDocumentStatus(documentId, "Failed").catch(() => undefined);
        } else {
          await fs.unlink(storedPath).catch(() => undefined);
        }
        await updateBatchFile(batchId, entry.originalName, {
          status: "Failed",
          documentId,
          errorMessage: message,
        });
      }
    });

    const status = failures > 0 ? BATCH_STATUSES.FAILED : BATCH_STATUSES.COMPLETED;
    return await updateBatchStatus(batchId, {
      status,
      completedAt: new Date(),
      errorMessage: failures > 0 ? `${failures} file(s) failed extraction.` : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch extraction failed.";
    return await updateBatchStatus(batchId, {
      status: BATCH_STATUSES.FAILED,
      completedAt: new Date(),
      errorMessage: message,
      retryCount: claimed.retryCount + 1,
    });
  }
};
