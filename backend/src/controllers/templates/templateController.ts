import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { hasClaudeCredentials } from "../../services/extract/anthropicClient.js";
import { uploadDir } from "../../middleware/documentUpload.js";
import { suggestTemplateFields } from "../../services/templates/fieldSuggestion.js";
import { testTemplateOnSamples } from "../../services/templates/sampleRun.js";
import {
  activateTemplateRecord,
  clearActiveTemplate,
  createTemplateRecord,
  deleteTemplateRecord,
  getActiveTemplate,
  getTemplateDocument,
  publicTemplateDocuments,
  replaceTemplateDocuments,
  requireTemplate,
  listTemplatesForApi,
  toJobTemplate,
  updateTemplateRecord,
} from "../../services/templates/templateService.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import type { TemplateFormInput } from "../../validators/templates/templateValidators.js";

const discard = (files: { path: string }[]) =>
  Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));

export const handleListTemplates = async (request: Request, response: Response) => {
  const query = request.query as { category?: string; q?: string };
  response.json(await listTemplatesForApi({ category: query.category, query: query.q }));
};

export const handleCreateTemplate = async (request: Request, response: Response) => {
  const body = request.body as TemplateFormInput;
  const template = await createTemplateRecord(body);
  response.status(HTTP_STATUS.CREATED).json(template);
};

export const handleGetActiveTemplate = async (_request: Request, response: Response) => {
  response.json({ template: await getActiveTemplate() });
};

export const handleActivateTemplate = async (request: Request, response: Response) => {
  response.json(await activateTemplateRecord(String(request.params.id)));
};

export const handleClearActiveTemplate = async (_request: Request, response: Response) => {
  await clearActiveTemplate();
  response.status(HTTP_STATUS.NO_CONTENT).end();
};

export const handleSuggestTemplateFields = async (request: Request, response: Response) => {
  const file = request.file;
  if (!file) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Choose a sample document.", { code: "FILE_REQUIRED" });
  }
  try {
    if (!hasClaudeCredentials()) {
      throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
        code: "CLAUDE_NOT_CONFIGURED",
      });
    }
    response.json(await suggestTemplateFields(file.path, file.originalname));
  } finally {
    await discard([file]);
  }
};

export const handleGetTemplate = async (request: Request, response: Response) => {
  response.json(await requireTemplate(String(request.params.id)));
};

export const handleUpdateTemplate = async (request: Request, response: Response) => {
  const body = request.body as TemplateFormInput;
  response.json(await updateTemplateRecord(String(request.params.id), body));
};

export const handleDeleteTemplate = async (request: Request, response: Response) => {
  await deleteTemplateRecord(String(request.params.id));
  response.status(HTTP_STATUS.NO_CONTENT).end();
};

export const handleListTemplateDocuments = async (request: Request, response: Response) => {
  response.json(await publicTemplateDocuments(String(request.params.id)));
};

export const handleGetTemplateDocumentFile = async (request: Request, response: Response) => {
  const doc = await getTemplateDocument(String(request.params.id), String(request.params.docId));
  if (!doc) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document not found.", { code: "NOT_FOUND" });
  }
  const filePath = path.join(uploadDir, path.basename(doc.storedName));
  response.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  response.setHeader(
    "Content-Disposition",
    `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
  );
  response.sendFile(filePath);
};

export const handleReplaceTemplateDocuments = async (request: Request, response: Response) => {
  const files = Array.isArray(request.files) ? request.files : [];
  try {
    await requireTemplate(String(request.params.id));
    const documents = await replaceTemplateDocuments(
      String(request.params.id),
      files.map((file) => ({
        fileName: path.basename(file.originalname),
        storedName: path.basename(file.filename),
        mimeType: file.mimetype || "",
      })),
    );
    response.json({
      documents: documents.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        createdAt: doc.createdAt,
      })),
    });
  } catch (error) {
    await discard(files);
    throw error;
  }
};

export const handleTestTemplate = async (request: Request, response: Response) => {
  const files = Array.isArray(request.files) ? request.files : [];
  try {
    if (!files.length) {
      throw AppError(HTTP_STATUS.BAD_REQUEST, "Upload at least one sample.", {
        code: "FILE_REQUIRED",
      });
    }
    if (!hasClaudeCredentials()) {
      throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
        code: "CLAUDE_NOT_CONFIGURED",
      });
    }
    const template = await requireTemplate(String(request.params.id));
    const job = toJobTemplate(template);
    const results = await testTemplateOnSamples(template.fields, files, {
      headerKeys: job.headerKeys,
      lineKeys: job.lineKeys,
    });
    response.json({ results });
  } finally {
    await discard(files);
  }
};
