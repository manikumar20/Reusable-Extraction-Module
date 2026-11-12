import fs from "node:fs/promises";
import type { Request, Response } from "express";
import {
  addExtractedField,
  editExtractedField,
  fieldsForDocument,
  fileMetaForDocument,
  listDocumentsForApi,
  removeDocument,
  removeExtractedField,
  saveDocumentsToLibrary,
} from "../../services/documents/documentService.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

const documentId = (request: Request) => Number(request.params.id);

export const handleListDocuments = async (_request: Request, response: Response) => {
  response.json(await listDocumentsForApi());
};

export const handleSaveDocuments = async (request: Request, response: Response) => {
  const ids = Array.isArray(request.body?.ids)
    ? request.body.ids.filter((id: unknown): id is number => typeof id === "number" && Number.isInteger(id))
    : [];
  if (!ids.length) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Choose extracted files to save.", { code: "IDS_REQUIRED" });
  }
  const saved = await saveDocumentsToLibrary(ids);
  response.json({ ids: saved });
};

export const handleGetDocumentFile = async (request: Request, response: Response) => {
  const meta = await fileMetaForDocument(documentId(request));
  if (!meta) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document not found.", { code: "NOT_FOUND" });
  }
  try {
    await fs.access(meta.filePath);
  } catch {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document file is missing.", { code: "NOT_FOUND" });
  }
  response.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
  response.setHeader(
    "Content-Disposition",
    `inline; filename="${meta.fileName.replace(/"/g, "")}"`,
  );
  response.sendFile(meta.filePath);
};

export const handleListDocumentFields = async (request: Request, response: Response) => {
  const fields = await fieldsForDocument(documentId(request));
  if (!fields) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document not found.", { code: "NOT_FOUND" });
  }
  response.json({ fields });
};

export const handleCreateExtractedField = async (request: Request, response: Response) => {
  const body = request.body as {
    fieldName: string;
    fieldKey?: string;
    fieldValue?: string;
    dataType?: string;
    source?: string;
  };
  const field = await addExtractedField({
    documentId: documentId(request),
    fieldName: body.fieldName,
    fieldKey: body.fieldKey,
    fieldValue: body.fieldValue,
    dataType: body.dataType,
    source: body.source || "MANUAL",
  });
  if (!field) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document not found.", { code: "NOT_FOUND" });
  }
  response.status(HTTP_STATUS.CREATED).json(field);
};

export const handleUpdateExtractedField = async (request: Request, response: Response) => {
  const body = request.body as { fieldValue: string; fieldName?: string };
  const field = await editExtractedField(
    documentId(request),
    String(request.params.fieldId),
    body.fieldValue,
    body.fieldName,
  );
  if (!field) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Field not found.", { code: "NOT_FOUND" });
  }
  response.json(field);
};

export const handleDeleteExtractedField = async (request: Request, response: Response) => {
  const removed = await removeExtractedField(documentId(request), String(request.params.fieldId));
  if (!removed) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Field not found.", { code: "NOT_FOUND" });
  }
  response.status(HTTP_STATUS.NO_CONTENT).end();
};

export const handleDeleteDocument = async (request: Request, response: Response) => {
  const removed = await removeDocument(documentId(request));
  if (!removed) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document not found.", { code: "NOT_FOUND" });
  }
  response.status(HTTP_STATUS.NO_CONTENT).end();
};
