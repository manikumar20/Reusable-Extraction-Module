import { Router } from "express";
import {
  handleActivateTemplate,
  handleClearActiveTemplate,
  handleCreateTemplate,
  handleDeleteTemplate,
  handleGetActiveTemplate,
  handleGetTemplate,
  handleGetTemplateDocumentFile,
  handleListTemplateDocuments,
  handleListTemplates,
  handleReplaceTemplateDocuments,
  handleSuggestTemplateFields,
  handleTestTemplate,
  handleUpdateTemplate,
} from "../../controllers/templates/templateController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  uploadDocument,
  uploadSamples,
  uploadTemplateDocuments,
} from "../../middleware/documentUpload.js";
import { validate } from "../../validators/_shared/index.js";
import {
  listTemplatesQuerySchema,
  templateDocumentParamsSchema,
  templateFormSchema,
  templateIdParamsSchema,
} from "../../validators/templates/templateValidators.js";

export const templateRouter = Router();

templateRouter.get(
  "/",
  validate({ query: listTemplatesQuerySchema }),
  asyncHandler(handleListTemplates),
);

templateRouter.post(
  "/",
  validate({ body: templateFormSchema }),
  asyncHandler(handleCreateTemplate),
);

templateRouter.get("/active", asyncHandler(handleGetActiveTemplate));

templateRouter.post(
  "/:id/activate",
  validate({ params: templateIdParamsSchema }),
  asyncHandler(handleActivateTemplate),
);

templateRouter.delete("/active", asyncHandler(handleClearActiveTemplate));

templateRouter.post(
  "/suggest-fields",
  uploadDocument.single("file"),
  asyncHandler(handleSuggestTemplateFields),
);

templateRouter.get(
  "/:id",
  validate({ params: templateIdParamsSchema }),
  asyncHandler(handleGetTemplate),
);

templateRouter.put(
  "/:id",
  validate({ params: templateIdParamsSchema, body: templateFormSchema }),
  asyncHandler(handleUpdateTemplate),
);

templateRouter.delete(
  "/:id",
  validate({ params: templateIdParamsSchema }),
  asyncHandler(handleDeleteTemplate),
);

templateRouter.get(
  "/:id/documents",
  validate({ params: templateIdParamsSchema }),
  asyncHandler(handleListTemplateDocuments),
);

templateRouter.get(
  "/:id/documents/:docId/file",
  validate({ params: templateDocumentParamsSchema }),
  asyncHandler(handleGetTemplateDocumentFile),
);

templateRouter.put(
  "/:id/documents",
  validate({ params: templateIdParamsSchema }),
  uploadTemplateDocuments.array("files", 10),
  asyncHandler(handleReplaceTemplateDocuments),
);

templateRouter.post(
  "/:id/test",
  validate({ params: templateIdParamsSchema }),
  uploadSamples.array("samples", 3),
  asyncHandler(handleTestTemplate),
);
