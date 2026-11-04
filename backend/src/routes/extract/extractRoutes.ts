import { Router } from "express";
import {
  handleCreateExtract,
  handleExtractEvents,
  handleGetExtract,
  handleGetExtractCatalog,
  handleGetExtractConfig,
} from "../../controllers/extract/extractController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { uploadDocument } from "../../middleware/documentUpload.js";
import { validate } from "../../validators/_shared/index.js";
import { extractIdParamsSchema } from "../../validators/extract/extractValidators.js";

export const extractRouter = Router();

extractRouter.get("/config", asyncHandler(handleGetExtractConfig));
extractRouter.get("/catalog", asyncHandler(handleGetExtractCatalog));

extractRouter.post("/", uploadDocument.single("file"), asyncHandler(handleCreateExtract));

extractRouter.get(
  "/:id",
  validate({ params: extractIdParamsSchema }),
  asyncHandler(handleGetExtract),
);

extractRouter.get(
  "/:id/events",
  validate({ params: extractIdParamsSchema }),
  asyncHandler(handleExtractEvents),
);
