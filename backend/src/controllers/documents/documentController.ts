import type { Request, Response } from "express";
import {
  editExtractedField,
  fieldsForDocument,
  listDocumentsForApi,
  removeDocument,
} from "../../services/documents/documentService.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

const documentId = (request: Request) => Number(request.params.id);

export const handleListDocuments = async (_request: Request, response: Response) => {
  response.json(await listDocumentsForApi());
};

export const handleListDocumentFields = async (request: Request, response: Response) => {
  const fields = await fieldsForDocument(documentId(request));
  if (!fields) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document not found.", { code: "NOT_FOUND" });
  }
  response.json({ fields });
};

export const handleUpdateExtractedField = async (request: Request, response: Response) => {
  const body = request.body as { fieldValue: string };
  const field = await editExtractedField(
    documentId(request),
    String(request.params.fieldId),
    body.fieldValue,
  );
  if (!field) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Field not found.", { code: "NOT_FOUND" });
  }
  response.json(field);
};

export const handleDeleteDocument = async (request: Request, response: Response) => {
  const removed = await removeDocument(documentId(request));
  if (!removed) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "Document not found.", { code: "NOT_FOUND" });
  }
  response.status(HTTP_STATUS.NO_CONTENT).end();
};
