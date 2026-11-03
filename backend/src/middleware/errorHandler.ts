import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { fail, HttpError } from "../utils/httpError.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json(fail(413, "File is larger than 25 MB.", "FILE_TOO_LARGE"));
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json(fail(error.status, error.message, error.code));
    return;
  }
  const message = error instanceof Error ? error.message : "Request failed.";
  console.error(message);
  res.status(500).json(fail(500, message, "REQUEST_FAILED"));
};
