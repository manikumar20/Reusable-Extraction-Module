import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Router } from "express";
import { Router as createRouter } from "express";
import {
  createTemplate,
  deleteTemplate,
  FIELD_TYPES,
  getActiveTemplate,
  getTemplate,
  getTemplateDocument,
  listTemplateDocuments,
  listTemplates,
  replaceTemplateDocuments,
  saveTemplateVersion,
  setActiveTemplate,
  TEMPLATE_CATEGORIES,
  type FieldInput,
  type FieldType,
  type SampleBox,
  type TemplateCategory,
} from "../../db/templates/templateDb.js";
import {
  uploadDocument,
  uploadDir,
  uploadSamples,
  uploadTemplateDocuments,
} from "../../middleware/documentUpload.js";
import { suggestTemplateFields } from "../../services/templates/fieldSuggestion.js";
import { testTemplateOnSamples } from "../../services/templates/sampleRun.js";
import { apiKey } from "../../app.js";
import { fail } from "../../utils/httpError.js";
import type { FieldLevel } from "../../db/templates/templateDb.js";

export const templateRouter: Router = createRouter();

const paramId = (req: Request) => {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id;
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const sampleBox = (value: unknown): SampleBox | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<SampleBox>;
  const page = Number(row.page);
  const x = Number(row.x);
  const y = Number(row.y);
  const w = Number(row.w);
  const h = Number(row.h);
  if (![page, x, y, w, h].every(Number.isFinite)) return undefined;
  if (page < 1 || w <= 0 || h <= 0) return undefined;
  return { page, x, y, w, h };
};

const readFields = (value: unknown): FieldInput[] | "invalid" => {
  if (!Array.isArray(value)) return "invalid";
  const fields: FieldInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return "invalid";
    const row = item as {
      id?: unknown;
      name?: unknown;
      type?: unknown;
      required?: unknown;
      hint?: unknown;
      format?: unknown;
      validation?: unknown;
      sampleBox?: unknown;
      catalogKey?: unknown;
      level?: unknown;
    };
    const name = text(row.name, 120);
    const type = text(row.type, 20);
    if (!name || !FIELD_TYPES.includes(type as FieldType)) return "invalid";
    const field: FieldInput = {
      name,
      type: type as FieldType,
      required: row.required === true,
    };
    if (typeof row.id === "string") field.id = row.id;
    const hint = text(row.hint, 300);
    const format = text(row.format, 80);
    const validation = text(row.validation, 300);
    const catalogKey = text(row.catalogKey, 80);
    const level = text(row.level, 20);
    if (hint) field.hint = hint;
    if (format) field.format = format;
    if (validation) field.validation = validation;
    if (catalogKey) field.catalogKey = catalogKey;
    if (level === "header" || level === "line") field.level = level as FieldLevel;
    const box = sampleBox(row.sampleBox);
    if (box) field.sampleBox = box;
    fields.push(field);
  }
  return fields;
};

const readTemplateBody = (body: unknown) => {
  if (!body || typeof body !== "object") return "invalid" as const;
  const row = body as { name?: unknown; category?: unknown; fields?: unknown };
  const name = text(row.name, 120);
  const category = text(row.category, 40);
  if (!name || !TEMPLATE_CATEGORIES.includes(category as TemplateCategory)) return "invalid" as const;
  const fields = readFields(row.fields);
  if (fields === "invalid") return "invalid" as const;
  const names = new Set<string>();
  for (const field of fields) {
    const key = field.name.toLowerCase();
    if (names.has(key)) return "duplicate" as const;
    names.add(key);
  }
  if (!fields.length) return "empty" as const;
  return { name, category: category as TemplateCategory, fields };
};

const rejectBody = (
  res: { status: (code: number) => { json: (body: unknown) => void } },
  parsed: "invalid" | "duplicate" | "empty",
) => {
  if (parsed === "duplicate") {
    res.status(400).json(fail(400, "Field names must be unique.", "TEMPLATE_FIELDS_DUPLICATE"));
    return;
  }
  if (parsed === "empty") {
    res.status(400).json(fail(400, "Add at least one field.", "TEMPLATE_FIELDS_EMPTY"));
    return;
  }
  res.status(400).json(fail(400, "The template could not be read.", "TEMPLATE_INVALID"));
};

templateRouter.get("/", async (req, res, next) => {
  try {
    const category = text(req.query.category, 40);
    const query = text(req.query.q, 120);
    const templates = await listTemplates({
      category: category || undefined,
      query: query || undefined,
    });
    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

templateRouter.post("/", async (req, res, next) => {
  try {
    const parsed = readTemplateBody(req.body);
    if (typeof parsed === "string") {
      rejectBody(res, parsed);
      return;
    }
    const template = await createTemplate(parsed);
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

const discard = (files: { path: string }[]) =>
  Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));

templateRouter.get("/active", async (_req, res, next) => {
  try {
    const template = await getActiveTemplate();
    res.json({ template });
  } catch (error) {
    next(error);
  }
});

templateRouter.post("/:id/activate", async (req, res, next) => {
  try {
    const template = await setActiveTemplate(paramId(req));
    if (!template) {
      res.status(404).json(fail(404, "Template not found.", "NOT_FOUND"));
      return;
    }
    res.json(template);
  } catch (error) {
    next(error);
  }
});

templateRouter.delete("/active", async (_req, res, next) => {
  try {
    await setActiveTemplate(null);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

templateRouter.post("/suggest-fields", uploadDocument.single("file"), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) {
      res.status(400).json(fail(400, "Choose a sample document.", "FILE_REQUIRED"));
      return;
    }
    if (!apiKey()) {
      await discard([file]);
      res.status(503).json(fail(503, "AI API key is not configured.", "CLAUDE_NOT_CONFIGURED"));
      return;
    }
    const result = await suggestTemplateFields(file.path, file.originalname);
    await discard([file]);
    res.json(result);
  } catch (error) {
    if (file) await discard([file]);
    next(error);
  }
});

templateRouter.get("/:id", async (req, res, next) => {
  try {
    const template = await getTemplate(paramId(req));
    if (!template) {
      res.status(404).json(fail(404, "Template not found.", "NOT_FOUND"));
      return;
    }
    res.json(template);
  } catch (error) {
    next(error);
  }
});

templateRouter.put("/:id", async (req, res, next) => {
  try {
    const parsed = readTemplateBody(req.body);
    if (typeof parsed === "string") {
      rejectBody(res, parsed);
      return;
    }
    const template = await saveTemplateVersion(paramId(req), parsed);
    if (!template) {
      res.status(404).json(fail(404, "Template not found.", "NOT_FOUND"));
      return;
    }
    res.json(template);
  } catch (error) {
    next(error);
  }
});

templateRouter.delete("/:id", async (req, res, next) => {
  try {
    const removed = await deleteTemplate(paramId(req));
    if (!removed) {
      res.status(404).json(fail(404, "Template not found.", "NOT_FOUND"));
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

templateRouter.get("/:id/documents", async (req, res, next) => {
  try {
    const templateId = paramId(req);
    if (!(await getTemplate(templateId))) {
      res.status(404).json(fail(404, "Template not found.", "NOT_FOUND"));
      return;
    }
    const documents = await listTemplateDocuments(templateId);
    res.json({
      documents: documents.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        createdAt: doc.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

templateRouter.get("/:id/documents/:docId/file", async (req, res, next) => {
  try {
    const templateId = paramId(req);
    const docId = Array.isArray(req.params.docId) ? req.params.docId[0] ?? "" : req.params.docId;
    const doc = await getTemplateDocument(templateId, docId);
    if (!doc) {
      res.status(404).json(fail(404, "Document not found.", "NOT_FOUND"));
      return;
    }
    const filePath = path.join(uploadDir, path.basename(doc.storedName));
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
    );
    res.sendFile(filePath, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

templateRouter.put(
  "/:id/documents",
  uploadTemplateDocuments.array("files", 10),
  async (req, res, next) => {
    const files = Array.isArray(req.files) ? req.files : [];
    try {
      const templateId = paramId(req);
      if (!(await getTemplate(templateId))) {
        await discard(files);
        res.status(404).json(fail(404, "Template not found.", "NOT_FOUND"));
        return;
      }
      const documents = await replaceTemplateDocuments(
        templateId,
        files.map((file) => ({
          fileName: path.basename(file.originalname),
          storedName: path.basename(file.filename),
          mimeType: file.mimetype || "",
        })),
      );
      res.json({
        documents: documents.map((doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          createdAt: doc.createdAt,
        })),
      });
    } catch (error) {
      await discard(files);
      next(error);
    }
  },
);

templateRouter.post("/:id/test", uploadSamples.array("samples", 3), async (req, res, next) => {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    if (!files.length) {
      res.status(400).json(fail(400, "Upload at least one sample.", "FILE_REQUIRED"));
      return;
    }
    if (!apiKey()) {
      await discard(files);
      res.status(503).json(fail(503, "AI API key is not configured.", "CLAUDE_NOT_CONFIGURED"));
      return;
    }
    const template = await getTemplate(paramId(req));
    if (!template) {
      await discard(files);
      res.status(404).json(fail(404, "Template not found.", "NOT_FOUND"));
      return;
    }
    const headerKeys = template.fields
      .filter((field) => field.level === "header" && field.catalogKey)
      .map((field) => field.catalogKey as string);
    const lineKeys = template.fields
      .filter((field) => field.level !== "header" && field.catalogKey)
      .map((field) => field.catalogKey as string);
    const results = await testTemplateOnSamples(template.fields, files, {
      headerKeys,
      lineKeys,
    });
    res.json({ results });
  } catch (error) {
    await discard(files);
    next(error);
  }
});
