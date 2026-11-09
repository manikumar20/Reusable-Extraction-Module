import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { documentModel, recordModel } from "../../config/runtime.js";
import { hasClaudeCredentials } from "../../services/extract/anthropicClient.js";
import { insertDocument } from "../../db/documents/documentDb.js";
import { getActiveTemplate, toJobTemplate } from "../../db/templates/templateDb.js";
import { HEADER_FIELDS, LINE_FIELDS } from "../../services/extract/engine/shared/fields.js";
import {
  ALLOWED_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
} from "../../middleware/documentUpload.js";
import { resolveDocumentType } from "../../services/documents/documentType.js";
import {
  createJob,
  getJob,
  runJob,
  subscribe,
  type JobTemplate,
} from "../../services/extract/extractService.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { extractTemplateSchema } from "../../validators/extract/extractValidators.js";

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const formText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
};

const readExtractTemplate = (body: unknown): JobTemplate | null => {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { template?: unknown }).template;
  if (raw === undefined || raw === "") return null;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== "string") {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "The template selection could not be read.", {
      code: "TEMPLATE_INVALID",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "The template selection could not be read.", {
      code: "TEMPLATE_INVALID",
    });
  }
  const row = extractTemplateSchema.parse(parsed);
  return {
    ...(row.id ? { id: row.id } : {}),
    name: row.name,
    headerKeys: row.headerKeys,
    lineKeys: row.lineKeys,
  };
};

export const handleGetExtractConfig = async (_request: Request, response: Response) => {
  response.json({
    ready: hasClaudeCredentials(),
    recordModel: recordModel(),
    documentModel: documentModel(),
    accept: ALLOWED_EXTENSIONS,
    maxUploadMb: MAX_UPLOAD_BYTES / (1024 * 1024),
    maxImageMb: MAX_IMAGE_BYTES / (1024 * 1024),
  });
};

export const handleGetExtractCatalog = async (_request: Request, response: Response) => {
  response.json({ header: HEADER_FIELDS, lines: LINE_FIELDS });
};

export const handleCreateExtract = async (request: Request, response: Response) => {
  const file = request.file;
  if (!file) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Choose a file to extract.", { code: "FILE_REQUIRED" });
  }

  const fileName = path.basename(file.originalname);
  if (IMAGE_EXTENSIONS.includes(extensionOf(fileName)) && file.size > MAX_IMAGE_BYTES) {
    await fs.unlink(file.path).catch(() => undefined);
    throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Images must be 5 MB or smaller.", {
      code: "IMAGE_TOO_LARGE",
    });
  }
  if (!hasClaudeCredentials()) {
    throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
      code: "CLAUDE_NOT_CONFIGURED",
    });
  }

  const requested = readExtractTemplate(request.body);
  const active = await getActiveTemplate();
  const template = active ? toJobTemplate(active) : requested;
  const requestedType = formText(
    request.body && typeof request.body === "object"
      ? (request.body as { documentType?: unknown }).documentType
      : "",
  );
  const document = await insertDocument({
    fileName,
    storedName: path.basename(file.filename),
    mimeType: file.mimetype || "",
    documentType: resolveDocumentType(requestedType, fileName),
  });

  const job = createJob(fileName, template, document.id);
  void runJob(job.id, file.path, fileName);
  response.status(HTTP_STATUS.ACCEPTED).json({ id: job.id, document });
};

export const handleGetExtract = async (request: Request, response: Response) => {
  const job = getJob(String(request.params.id));
  if (!job) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Extraction not found.", { code: "NOT_FOUND" });
  }
  response.json(job);
};

export const handleExtractEvents = async (request: Request, response: Response) => {
  const id = String(request.params.id);
  if (!getJob(id)) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Extraction not found.", { code: "NOT_FOUND" });
  }

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  const closed = () => response.writableEnded || Boolean(response.socket?.destroyed);
  const send = () => {
    if (closed()) return;
    const job = getJob(id);
    if (!job) return;
    response.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
  };
  const unsubscribe = subscribe(id, send);
  send();
  const beat = setInterval(() => {
    try {
      if (closed()) {
        clearInterval(beat);
        unsubscribe();
        return;
      }
      response.write(": ping\n\n");
    } catch {
      clearInterval(beat);
      unsubscribe();
    }
  }, 15_000);
  request.on("close", () => {
    clearInterval(beat);
    unsubscribe();
  });
};
