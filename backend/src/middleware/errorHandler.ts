import type { ErrorRequestHandler } from "express";
import { HttpError } from "../utils/httpError.js";
import { HTTP_STATUS, isAppError } from "../utils/errors/index.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isAppError(error)) {
    res.status(error.statusCode).json({
      error: {
        message: error.message,
        code: error.code,
        status: error.statusCode,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { message: error.message, code: error.code, status: error.status },
    });
    return;
  }

  console.error(error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: {
      message: error instanceof Error ? error.message : "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    },
  });
};
