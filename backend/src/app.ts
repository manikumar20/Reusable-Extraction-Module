import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import type { ExtraFieldValue } from "./extraction/cleaner/clean.js";
import { ExtractionError, extractDocument } from "./extraction/extract/run.js";
import {
  lineFieldValues,
  lineIdentityValue,
  type ExtractedLine,
} from "./extraction/extract/records.js";
import { EXTRACTION_MODEL, HEADER_MODEL } from "./extraction/shared/constants.js";
import {
  FIELD_DATA_TYPES,
  LINE_FIELDS,
  type CatalogField,
} from "./extraction/shared/fields.js";
import { tokenCostUsd, type ExtractionTokenUsage } from "./extraction/shared/tokens.js";
import { getTemplate } from "./db/templates/templateDb.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./routes/index.js";
import { fail } from "./utils/httpError.js";

const typeFromTemplate = (value: string): CatalogField["dataType"] => {
  if (value === "date") return FIELD_DATA_TYPES.DATE;
  if (value === "number" || value === "currency") return FIELD_DATA_TYPES.NUMBER;
  if (value === "table") return FIELD_DATA_TYPES.LIST;
  return FIELD_DATA_TYPES.TEXT;
};

const extrasFromTemplate = async (template: JobTemplate | null) => {
  if (!template?.id) return undefined;
  const saved = await getTemplate(template.id);
  if (!saved) return undefined;
  const byKey = new Map(LINE_FIELDS.map((field) => [field.key, field]));
  return saved.fields.flatMap((field) => {
    if (field.level === "header") return [];
    if (field.catalogKey && byKey.has(field.catalogKey)) {
      const catalog = byKey.get(field.catalogKey);
      return catalog && !catalog.isDefault ? [catalog] : [];
    }
    if (!field.catalogKey && !field.name.trim()) return [];
    const key = field.catalogKey || field.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (byKey.has(key) && byKey.get(key)?.isDefault) return [];
    return [
      {
        key,
        label: field.name,
        dataType: typeFromTemplate(field.type),
        description: field.hint || field.validation || field.name,
      } satisfies CatalogField,
    ];
  });
};

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

type Job = PublicJob & { listeners: Set<() => void> };

const jobs = new Map<string, Job>();

/** Newest upload wins — abort any extract still holding Claude slots. */
let activeJobAbort: AbortController | null = null;

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

export const recordModel = () =>
  process.env.RECORD_MODEL?.trim() || EXTRACTION_MODEL;

export const documentModel = () =>
  process.env.DOCUMENT_MODEL?.trim() || HEADER_MODEL;

export const apiKey = () => process.env.ANTHROPIC_API_KEY?.trim() ?? "";

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

export const createJob = (fileName: string, template: JobTemplate | null = null): PublicJob => {
  // Free Claude slots / PDF work from a previous upload so the new file is not queued behind it.
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

const phaseFor = (percent: number): JobPhase =>
  percent < 20 ? "reading" : percent >= 99 ? "header" : "lines";

export const runJob = async (id: string, filePath: string, fileName: string) => {
  const job = jobs.get(id);
  if (!job) return;

  const abort = new AbortController();
  activeJobAbort = abort;

  try {
    const lineExtras = await extrasFromTemplate(job.template);
    const result = await extractDocument({
      filePath,
      fileName,
      apiKey: apiKey(),
      recordModel: recordModel(),
      documentModel: documentModel(),
      headerKeys: job.template?.headerKeys,
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
    job.header = result.header;
    job.usage = result.usage;
    job.headerUsage = result.headerUsage;
    job.lineCostUsd = tokenCostUsd(result.usage);
    job.headerCostUsd = tokenCostUsd(result.headerUsage);
    job.status = "done";
    job.phase = "done";
    job.progress = 100;
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
    if (!cancelled) {
      console.error(`Job ${id} failed for ${fileName}: ${job.error.message}`);
    }
  } finally {
    if (activeJobAbort === abort) activeJobAbort = null;
  }

  notify(job);
};

export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const normalized = origin.replace(/\/$/, "");
        if (env.corsOrigins.includes(normalized)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept"],
    }),
  );
  // Required for Save template (JSON POST/PUT). Multipart uploads still use multer.
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", apiRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json(fail(404, "Not found.", "NOT_FOUND"));
  });
  app.use(errorHandler);
  return app;
};
