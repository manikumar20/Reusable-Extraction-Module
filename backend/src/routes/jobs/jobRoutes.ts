import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Router } from "express";
import { Router as createRouter } from "express";
import { insertDocument } from "../../db/documents/documentDb.js";
import {
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  uploadDocument,
} from "../../middleware/documentUpload.js";
import { resolveDocumentType } from "../../services/documents/documentType.js";
import {
  apiKey,
  createJob,
  getJob,
  runJob,
  subscribe,
  type JobTemplate,
} from "../../app.js";
import { getActiveTemplate, toJobTemplate } from "../../db/templates/templateDb.js";
import { fail } from "../../utils/httpError.js";

export const jobRouter: Router = createRouter();

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const paramId = (req: Request) => {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id;
};

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const formText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
};

const readTemplate = (body: unknown): JobTemplate | null | "invalid" => {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { template?: unknown }).template;
  if (raw === undefined || raw === "") return null;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== "string") return "invalid";
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return "invalid";
    const row = parsed as {
      id?: unknown;
      name?: unknown;
      headerKeys?: unknown;
      lineKeys?: unknown;
    };
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 120) : "";
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 80) : "";
    return {
      ...(id ? { id } : {}),
      name,
      headerKeys: stringList(row.headerKeys).slice(0, 200),
      lineKeys: stringList(row.lineKeys).slice(0, 200),
    };
  } catch {
    return "invalid";
  }
};

jobRouter.post("/", uploadDocument.single("file"), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) {
      res.status(400).json(fail(400, "Choose a file to extract.", "FILE_REQUIRED"));
      return;
    }

    const fileName = path.basename(file.originalname);
    if (IMAGE_EXTENSIONS.includes(extensionOf(fileName)) && file.size > MAX_IMAGE_BYTES) {
      await fs.unlink(file.path).catch(() => undefined);
      res.status(413).json(fail(413, "Images must be 5 MB or smaller.", "IMAGE_TOO_LARGE"));
      return;
    }
    if (!apiKey()) {
      res.status(503).json(fail(503, "AI API key is not configured.", "CLAUDE_NOT_CONFIGURED"));
      return;
    }

    const requested = readTemplate(req.body);
    if (requested === "invalid") {
      await fs.unlink(file.path).catch(() => undefined);
      res.status(400).json(fail(400, "The template selection could not be read.", "TEMPLATE_INVALID"));
      return;
    }
    // Active template is the source of truth for extraction; client payload is fallback only.
    const active = await getActiveTemplate();
    const template = active ? toJobTemplate(active) : requested;
    const requestedType = formText(
      req.body && typeof req.body === "object"
        ? (req.body as { documentType?: unknown }).documentType
        : "",
    );
    const document = await insertDocument({
      fileName,
      storedName: path.basename(file.filename),
      mimeType: file.mimetype || "",
      documentType: resolveDocumentType(requestedType, fileName),
    });

    const job = createJob(fileName, template);
    void runJob(job.id, file.path, fileName);
    res.status(202).json({ id: job.id, document });
  } catch (error) {
    next(error);
  }
});

jobRouter.get("/:id", (req, res) => {
  const job = getJob(paramId(req));
  if (!job) {
    res.status(404).json(fail(404, "Extraction job not found.", "NOT_FOUND"));
    return;
  }
  res.json(job);
});

jobRouter.get("/:id/events", (req, res) => {
  const id = paramId(req);
  if (!getJob(id)) {
    res.status(404).json(fail(404, "Extraction job not found.", "NOT_FOUND"));
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const closed = () => res.writableEnded || Boolean(res.socket?.destroyed);
  const send = () => {
    if (closed()) return;
    const job = getJob(id);
    if (!job) return;
    res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
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
      res.write(": ping\n\n");
    } catch {
      clearInterval(beat);
      unsubscribe();
    }
  }, 15_000);
  req.on("close", () => {
    clearInterval(beat);
    unsubscribe();
  });
});
