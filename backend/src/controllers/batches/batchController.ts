import type { Request, Response } from "express";
import {
  discardStagedFile,
  getStagedFile,
  listCompressedFiles,
  publicStagedFile,
  runStagedFile,
  stageUploads,
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
  const templateId = formText(body.templateId) || undefined;
  const staged = await stageUploads({
    files: files.map((file) => ({
      originalname: file.originalname,
      buffer: file.buffer,
      size: file.size,
      mimetype: file.mimetype,
    })),
    templateId,
    deferTemplate: body.deferTemplate === true,
  });

  if (body.run !== false) {
    await Promise.all(staged.map((file) => runStagedFile(file.id)));
  }

  const latest = await Promise.all(staged.map((file) => getStagedFile(file.id)));
  response.status(HTTP_STATUS.ACCEPTED).json({
    files: latest.map(publicStagedFile),
  });
};

export const handleListBatches = async (_request: Request, response: Response) => {
  const files = await listCompressedFiles();
  response.json({ files: files.map(publicStagedFile) });
};

export const handleGetBatch = async (request: Request, response: Response) => {
  const file = await getStagedFile(String(request.params.id));
  response.json({ file: publicStagedFile(file) });
};

export const handleRunBatch = async (request: Request, response: Response) => {
  const file = await runStagedFile(String(request.params.id));
  response.status(HTTP_STATUS.ACCEPTED).json({ file: publicStagedFile(file) });
};

export const handleDeleteBatch = async (request: Request, response: Response) => {
  await discardStagedFile(String(request.params.id));
  response.status(HTTP_STATUS.NO_CONTENT).end();
};
