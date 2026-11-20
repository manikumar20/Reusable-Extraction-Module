import { Router } from "express";
import {
  handleCreateBatch,
  handleDeleteBatch,
  handleGetBatch,
  handleListBatches,
  handleRunBatch,
} from "../../controllers/batches/batchController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { uploadBatchFiles } from "../../middleware/documentUpload.js";
import { validate } from "../../validators/_shared/index.js";
import {
  batchIdParamsSchema,
  createBatchBodySchema,
} from "../../validators/batches/batchValidators.js";

export const batchRouter = Router();

batchRouter.get("/", asyncHandler(handleListBatches));

batchRouter.post(
  "/",
  uploadBatchFiles.array("files", 50),
  validate({ body: createBatchBodySchema }),
  asyncHandler(handleCreateBatch),
);

batchRouter.get(
  "/:id",
  validate({ params: batchIdParamsSchema }),
  asyncHandler(handleGetBatch),
);

batchRouter.post(
  "/:id/run",
  validate({ params: batchIdParamsSchema }),
  asyncHandler(handleRunBatch),
);

batchRouter.delete(
  "/:id",
  validate({ params: batchIdParamsSchema }),
  asyncHandler(handleDeleteBatch),
);
