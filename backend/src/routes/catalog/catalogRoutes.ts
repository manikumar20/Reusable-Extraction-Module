import { Router } from "express";
import { HEADER_FIELDS, LINE_FIELDS } from "../../extraction/shared/fields.js";
import {
  ALLOWED_EXTENSIONS,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
} from "../../middleware/documentUpload.js";
import { apiKey, documentModel, recordModel } from "../../app.js";

export const catalogRouter = Router();

catalogRouter.get("/config", (_req, res) => {
  res.json({
    ready: Boolean(apiKey()),
    recordModel: recordModel(),
    documentModel: documentModel(),
    accept: ALLOWED_EXTENSIONS,
    maxUploadMb: MAX_UPLOAD_BYTES / (1024 * 1024),
    maxImageMb: MAX_IMAGE_BYTES / (1024 * 1024),
  });
});

catalogRouter.get("/catalog", (_req, res) => {
  res.json({ header: HEADER_FIELDS, lines: LINE_FIELDS });
});
