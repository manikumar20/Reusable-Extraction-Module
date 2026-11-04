import type { Request, Response } from "express";
import { listDocumentsForApi } from "../../services/documents/documentService.js";

export const handleListDocuments = async (_request: Request, response: Response) => {
  response.json(await listDocumentsForApi());
};
