import { randomUUID } from "node:crypto";
import type { ExtraFieldValue } from "./engine/cleaner/clean.js";
import { ExtractionError, extractDocument } from "./engine/extract/run.js";
import {
  lineFieldValues,
  lineIdentityValue,
  type ExtractedLine,
} from "./engine/extract/records.js";
import {
  FIELD_DATA_TYPES,
  HEADER_FIELDS,
  LINE_FIELDS,
  type CatalogField,
} from "./engine/shared/fields.js";
import { tokenCostUsd, type ExtractionTokenUsage } from "./engine/shared/tokens.js";
import { saveExtractedFields, updateDocumentStatus } from "../../db/documents/documentDb.js";
import { getTemplate } from "../../db/templates/templateDb.js";
import { apiKey, documentModel, recordModel } from "../../config/runtime.js";

export type JobTemplate = {
  id?: string;
  name: string;
  headerKeys: string[];
  lineKeys: string[];
};

export type JobPhase = "reading" | "lines" | "header" | "done" | "error";

export type PublicJob = {
  id: string;
  fileName: string;
  status: "running" | "done" | "error";
  phase: JobPhase;
  progress: number;
  header: Record<string, ExtraFieldValue>;
  lines: ExtractedLine[];
  usage: ExtractionTokenUsage;
  headerUsage: ExtractionTokenUsage;
  lineCostUsd: number;
  headerCostUsd: number;
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
 * Split a saved template into header fields and optional line fields.
 * Custom fields that are not catalogue line columns are read as header values,
 * so a template such as Patient Name is saved and shown after extract.
 */
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
  header: job.header,
  lines: job.lines.map((line) => ({ fields: lineFieldValues(line) })),
  usage: job.usage,
  headerUsage: job.headerUsage,
  lineCostUsd: job.lineCostUsd,
  headerCostUsd: job.headerCostUsd,
  template: job.template,
  error: job.error,
});

const phaseFor = (percent: number): JobPhase =>
  percent < 20 ? "reading" : percent >= 99 ? "header" : "lines";

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
    header: {},
    lines: [],
    usage: { inputTokens: 0, outputTokens: 0, model: recordModel() },
    headerUsage: { inputTokens: 0, outputTokens: 0, model: documentModel() },
    lineCostUsd: 0,
    headerCostUsd: 0,
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

export const runJob = async (id: string, filePath: string, fileName: string) => {
  const job = jobs.get(id);
  if (!job) return;

  const abort = new AbortController();
  activeJobAbort = abort;

  try {
    const schema = await schemaFromTemplate(job.template);
    const result = await extractDocument({
      filePath,
      fileName,
      apiKey: apiKey(),
      recordModel: recordModel(),
      documentModel: documentModel(),
      headerKeys: job.template?.headerKeys,
      lineKeys: job.template?.lineKeys,
      headerFields: schema?.headerFields,
      lineExtras: schema?.lineExtras,
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
    job.header = result.header;
    job.usage = result.usage;
    job.headerUsage = result.headerUsage;
    job.lineCostUsd = tokenCostUsd(result.usage);
    job.headerCostUsd = tokenCostUsd(result.headerUsage);
    job.status = "done";
    job.phase = "done";
    job.progress = 100;
    // Publish results immediately so Inspect Results can render fields
    // without waiting for the document DB write.
    notify(job);
    if (job.documentId != null) {
      await saveExtractedFields({
        documentId: job.documentId,
        header: job.header,
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
    if (activeJobAbort === abort) activeJobAbort = null;
  }

  notify(job);
};
