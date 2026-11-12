import { Router } from "express";
import {
  handleCreateExtractedField,
  handleDeleteDocument,
  handleDeleteExtractedField,
  handleGetDocumentFile,
  handleListDocumentFields,
  handleListDocuments,
  handleSaveDocuments,
  handleUpdateExtractedField,
} from "../../controllers/documents/documentController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../validators/_shared/index.js";
import {
  createExtractedFieldSchema,
  documentIdParamsSchema,
  extractedFieldParamsSchema,
  updateExtractedFieldSchema,
} from "../../validators/documents/documentValidators.js";

export const documentRouter = Router();

documentRouter.get("/", asyncHandler(handleListDocuments));
documentRouter.post("/save", asyncHandler(handleSaveDocuments));

documentRouter.get(
  "/:id/file",
  validate({ params: documentIdParamsSchema }),
  asyncHandler(handleGetDocumentFile),
);

documentRouter.get(
  "/:id/fields",
  validate({ params: documentIdParamsSchema }),
  asyncHandler(handleListDocumentFields),
);

documentRouter.post(
  "/:id/fields",
  validate({ params: documentIdParamsSchema, body: createExtractedFieldSchema }),
  asyncHandler(handleCreateExtractedField),
);

documentRouter.patch(
  "/:id/fields/:fieldId",
  validate({ params: extractedFieldParamsSchema, body: updateExtractedFieldSchema }),
  asyncHandler(handleUpdateExtractedField),
);

documentRouter.delete(
  "/:id/fields/:fieldId",
  validate({ params: extractedFieldParamsSchema }),
  asyncHandler(handleDeleteExtractedField),
);

documentRouter.delete(
  "/:id",
  validate({ params: documentIdParamsSchema }),
  asyncHandler(handleDeleteDocument),
);
