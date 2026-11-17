import type { Request, Response } from "express";
import {
  createBatchFromUploads,
  getBatchDetail,
  listExtractionBatches,
  publicBatch,
  runBatchNow,
} from "../../services/batches/batchService.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import type { CreateBatchBody } from "../../validators/batches/batchValidators.js";

const formText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
};

export const handleCreateBatch = async (request: Request, response: Response) => {
  const files = request.files;
  if (!Array.isArray(files) || !files.length) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Choose at least one file to upload.", {
      code: "FILES_REQUIRED",
    });
  }

  const body = request.body as CreateBatchBody;
  const jobName = formText(body.jobName) || undefined;
  const templateId = formText(body.templateId) || undefined;

  const batch = await createBatchFromUploads({
    files: files.map((file) => ({
      originalname: file.originalname,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
    })),
    jobName,
    templateId,
  });

  const detail = await runBatchNow(batch.id);
  response.status(HTTP_STATUS.ACCEPTED).json({
    batch: publicBatch(detail.batch),
    files: detail.files,
  });
};

export const handleListBatches = async (_request: Request, response: Response) => {
  const batches = await listExtractionBatches();
  response.json({ batches: batches.map(publicBatch) });
};

export const handleGetBatch = async (request: Request, response: Response) => {
  const detail = await getBatchDetail(String(request.params.id));
  response.json({
    batch: publicBatch(detail.batch),
    files: detail.files,
  });
};

export const handleRunBatch = async (request: Request, response: Response) => {
  const detail = await runBatchNow(String(request.params.id));
  response.status(HTTP_STATUS.ACCEPTED).json({
    batch: publicBatch(detail.batch),
    files: detail.files,
  });
};
