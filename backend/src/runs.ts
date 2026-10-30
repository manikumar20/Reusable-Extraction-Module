import { randomUUID } from "node:crypto";
import { ExtractionError, extractDocument } from "./extraction/extract/run.js";
import type { ExtractedLine } from "./extraction/extract/records.js";
import type { ExtraFieldValue } from "./extraction/cleaner/clean.js";
import { EXTRACTION_MODEL, HEADER_MODEL } from "./extraction/shared/constants.js";
import { tokenCostUsd, type ExtractionTokenUsage } from "./extraction/shared/tokens.js";

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
  error: { message: string; code: string; status: number } | null;
};

type Job = PublicJob & { listeners: Set<() => void> };

const jobs = new Map<string, Job>();

/** A later batch for the same line number replaces the earlier row. */
const mergeLines = (current: ExtractedLine[], batch: ExtractedLine[]) => {
  const lines = [...current];
  for (const item of batch) {
    const number = item.customerItemNumber.trim();
    const index = lines.findIndex((line) =>
      number
        ? line.customerItemNumber.trim() === number
        : JSON.stringify(line) === JSON.stringify(item),
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
  lines: job.lines,
  usage: job.usage,
  headerUsage: job.headerUsage,
  lineCostUsd: job.lineCostUsd,
  headerCostUsd: job.headerCostUsd,
  error: job.error,
});

export const createJob = (fileName: string): PublicJob => {
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

  try {
    const result = await extractDocument({
      filePath,
      fileName,
      apiKey: apiKey(),
      recordModel: recordModel(),
      documentModel: documentModel(),
      onProgress: async (percent) => {
        job.progress = percent;
        job.phase = phaseFor(percent);
        notify(job);
      },
      onRecords: async (records) => {
        job.lines = mergeLines(job.lines, records);
        if (job.phase === "reading") job.phase = "lines";
        notify(job);
      },
    });
    job.header = result.header;
    job.usage = result.usage;
    job.headerUsage = result.headerUsage;
    job.lineCostUsd = tokenCostUsd(result.usage);
    job.headerCostUsd = tokenCostUsd(result.headerUsage);
    job.status = "done";
    job.phase = "done";
    job.progress = 100;
  } catch (error) {
    const known = error instanceof ExtractionError ? error : null;
    job.status = "error";
    job.phase = "error";
    job.error = {
      message: error instanceof Error ? error.message : "Extraction failed.",
      code: known?.code ?? "EXTRACTION_FAILED",
      status: known?.status ?? 500,
    };
    console.error(`Job ${id} failed for ${fileName}: ${job.error.message}`);
  }

  notify(job);
};
