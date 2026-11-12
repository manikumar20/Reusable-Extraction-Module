import type { ExtractedFieldRow, Job, StoredDocument } from "./types";

/** Build a review Job from persisted document fields (Documents / Inspect). */
export const jobFromDocument = (document: StoredDocument, fields: ExtractedFieldRow[]): Job => {
  const header: Record<string, string> = {};
  for (const field of fields) {
    const key =
      field.fieldKey?.trim() ||
      field.fieldName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (!key) continue;
    header[key] = field.fieldValue;
  }
  const done = (document.status || "").toLowerCase() === "completed" || fields.length > 0;
  return {
    id: `document-${document.id}`,
    fileName: document.fileName,
    status: done ? "done" : document.status?.toLowerCase() === "failed" ? "error" : "running",
    phase: done ? "done" : "reading",
    progress: done ? 100 : 40,
    header,
    lines: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    headerUsage: { inputTokens: 0, outputTokens: 0 },
    lineCostUsd: 0,
    headerCostUsd: 0,
    template: {
      name: "Saved extraction",
      headerKeys: Object.keys(header),
      lineKeys: [],
    },
    error: null,
  };
};

export const mimeForFileName = (fileName: string, fallback = "application/octet-stream") => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/i.test(lower)) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  return fallback;
};
