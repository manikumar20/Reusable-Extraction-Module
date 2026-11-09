import { Router } from "express";
import {
  handleDeleteDocument,
  handleListDocumentFields,
  handleListDocuments,
  handleUpdateExtractedField,
} from "../../controllers/documents/documentController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../validators/_shared/index.js";
import {
  documentIdParamsSchema,
  extractedFieldParamsSchema,
  updateExtractedFieldSchema,
} from "../../validators/documents/documentValidators.js";

export const documentRouter = Router();

documentRouter.get("/", asyncHandler(handleListDocuments));

documentRouter.get(
  "/:id/fields",
  validate({ params: documentIdParamsSchema }),
  asyncHandler(handleListDocumentFields),
);

documentRouter.patch(
  "/:id/fields/:fieldId",
  validate({ params: extractedFieldParamsSchema, body: updateExtractedFieldSchema }),
  asyncHandler(handleUpdateExtractedField),
);

documentRouter.delete(
  "/:id",
  validate({ params: documentIdParamsSchema }),
  asyncHandler(handleDeleteDocument),
);
