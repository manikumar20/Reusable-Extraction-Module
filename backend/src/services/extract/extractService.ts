import { randomUUID } from "node:crypto";
import { ExtractionError, extractDocument } from "./engine/extract/run.js";
import {
  lineFieldValues,
  lineIdentityValue,
  type ExtractedLine,
} from "./engine/extract/records.js";
import {
  FIELD_DATA_TYPES,
  LINE_FIELDS,
  type CatalogField,
} from "./engine/shared/fields.js";
import { tokenCostUsd, type ExtractionTokenUsage } from "./engine/shared/tokens.js";
import { deleteDocument, insertExtractedDocument, saveExtractedFields, updateDocumentStatus } from "../../db/documents/documentDb.js";
import { getTemplate } from "../../db/templates/templateDb.js";
import { apiKey, recordModel } from "../../config/runtime.js";
import { attachSourceLocations } from "../sourceMapping/index.js";

export type JobTemplate = {
  id?: string;
  name: string;
  lineKeys: string[];
};

export type JobPhase = "reading" | "lines" | "done" | "error";

export type PublicJob = {
  id: string;
  fileName: string;
  status: "running" | "done" | "error";
  phase: JobPhase;
  progress: number;
  lines: ExtractedLine[];
  usage: ExtractionTokenUsage;
  lineCostUsd: number;
  template: JobTemplate | null;
  error: { message: string; code: string; status: number } | null;
};

type Job = PublicJob & { listeners: Set<() => void>; documentId: number | null };

const jobs = new Map<string, Job>();

/** Newest upload wins — abort any extract still holding Claude slots. */
let activeJobAbort: AbortController | null = null;

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

/**
 * Template fields sent to extraction.
 * A matching catalogue field keeps its catalogue definition. Any other name is added as a custom field.
 */
export const lineExtrasFromTemplate = async (
  template: JobTemplate | null,
): Promise<CatalogField[] | undefined> => {
  if (!template?.id) return undefined;
  const saved = await getTemplate(template.id);
  if (!saved) return undefined;
  const lineByKey = new Map(LINE_FIELDS.map((field) => [field.key, field]));
  const lineExtras: CatalogField[] = [];
  const seen = new Set<string>();
  for (const field of saved.fields) {
    const key = field.catalogKey?.trim() || slugKey(field.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const lineCatalog = lineByKey.get(key);
    if (lineCatalog) {
      lineExtras.push(lineCatalog);
      continue;
    }
    lineExtras.push({
      key,
      label: field.name.trim() || key,
      dataType: typeFromTemplate(field.type),
      description: field.hint || field.validation || field.name,
    });
  }
  return lineExtras;
};

/** A later batch for the same line identity replaces the earlier row. */
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

const notify = (job: Job) => {
  for (const listener of [...job.listeners]) {
    try {
      listener();
    } catch (error) {
      console.error(
        `Job ${job.id} update failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
};

const view = (job: Job): PublicJob => ({
  id: job.id,
  fileName: job.fileName,
  status: job.status,
  phase: job.phase,
  progress: job.progress,
  lines: job.lines.map((line) => ({
    fields: lineFieldValues(line),
    ...(line.locations && Object.keys(line.locations).length
      ? { locations: line.locations }
      : {}),
  })),
  usage: job.usage,
  lineCostUsd: job.lineCostUsd,
  template: job.template,
  error: job.error,
});

const phaseFor = (percent: number): JobPhase =>
  percent < 20 ? "reading" : "lines";

export const createJob = (
  fileName: string,
  template: JobTemplate | null = null,
  documentId: number | null = null,
): PublicJob => {
  if (activeJobAbort) {
    activeJobAbort.abort();
    activeJobAbort = null;
  }
  for (const prior of jobs.values()) {
    if (prior.status !== "running") continue;
    prior.status = "error";
    prior.phase = "error";
    prior.error = {
      message: "Replaced by a newer upload.",
      code: "JOB_SUPERSEDED",
      status: 499,
    };
    notify(prior);
  }

  const job: Job = {
    id: randomUUID(),
    fileName,
    status: "running",
    phase: "reading",
    progress: 0,
    lines: [],
    usage: { inputTokens: 0, outputTokens: 0, model: recordModel() },
    lineCostUsd: 0,
    template,
    error: null,
    documentId,
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  for (const [id, saved] of jobs) {
    if (jobs.size <= 30) break;
    if (saved.status !== "running") jobs.delete(id);
  }
  return view(job);
};

export const getJob = (id: string) => {
  const job = jobs.get(id);
  return job ? view(job) : undefined;
};

export const subscribe = (id: string, listener: () => void) => {
  const job = jobs.get(id);
  if (!job) return () => undefined;
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
};

export const runJob = async (
  id: string,
  fileBuffer: Buffer,
  fileName: string,
  stored?: {
    gzip: Buffer;
    mimeType: string;
    documentType: string;
    templateId: number | null;
  },
) => {
  const job = jobs.get(id);
  if (!job) {
    fileBuffer.fill(0);
    return;
  }

  const abort = new AbortController();
  activeJobAbort = abort;

  try {
    const lineExtras = await lineExtrasFromTemplate(job.template);
    const result = await extractDocument({
      filePath: fileName,
      fileBuffer,
      fileName,
      apiKey: apiKey(),
      recordModel: recordModel(),
      lineKeys: job.template?.lineKeys,
      lineExtras,
      signal: abort.signal,
      onProgress: async (percent) => {
        if (abort.signal.aborted) return;
        job.progress = percent;
        job.phase = phaseFor(percent);
        notify(job);
      },
      onRecords: async (records) => {
        if (abort.signal.aborted || job.status !== "running") return;
        job.lines = mergeLines(job.lines, records);
        if (job.phase === "reading") job.phase = "lines";
        notify(job);
      },
    });
    if (abort.signal.aborted || job.status !== "running") return;
    job.usage = result.usage;
    job.lineCostUsd = tokenCostUsd(result.usage);
    // Locate values in the source file (never re-runs Claude).
    try {
      job.lines = await attachSourceLocations({
        fileName,
        mimeType: stored?.mimeType,
        buffer: fileBuffer,
        lines: job.lines,
      });
    } catch {
      // Mapping failures must not fail extraction.
    }
    job.status = "done";
    job.phase = "done";
    job.progress = 100;
    // Publish results immediately so Inspect Results can render fields
    // without waiting for the document DB write.
    notify(job);
    if (stored) {
      const created = await insertExtractedDocument({
        fileName,
        mimeType: stored.mimeType,
        documentType: stored.documentType,
        templateId: stored.templateId,
        fileData: stored.gzip,
      });
      try {
        await saveExtractedFields({
          documentId: created.id,
          lines: job.lines,
        });
      } catch (saveError) {
        await deleteDocument(created.id).catch(() => undefined);
        throw saveError;
      }
      job.documentId = created.id;
    } else if (job.documentId != null) {
      await saveExtractedFields({
        documentId: job.documentId,
        lines: job.lines,
      });
    }
  } catch (error) {
    if (abort.signal.aborted || job.status !== "running") return;
    const known = error instanceof ExtractionError ? error : null;
    const cancelled =
      error instanceof Error &&
      (error.name === "AbortError" || /cancelled/i.test(error.message));
    job.status = "error";
    job.phase = "error";
    job.error = {
      message: cancelled
        ? "Replaced by a newer upload."
        : error instanceof Error
          ? error.message
          : "Extraction failed.",
      code: cancelled ? "JOB_SUPERSEDED" : (known?.code ?? "EXTRACTION_FAILED"),
      status: cancelled ? 499 : (known?.status ?? 500),
    };
    if (job.documentId != null && !cancelled) {
      await updateDocumentStatus(job.documentId, "Failed").catch(() => undefined);
    }
    if (!cancelled) {
      console.error(`Job ${id} failed for ${fileName}: ${job.error.message}`);
    }
  } finally {
    fileBuffer.fill(0);
    if (activeJobAbort === abort) activeJobAbort = null;
  }

  notify(job);
};
