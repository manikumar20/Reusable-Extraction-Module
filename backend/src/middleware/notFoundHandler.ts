import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../utils/errors/index.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    error: {
      message: "Route not found",
      code: "NOT_FOUND",
      status: HTTP_STATUS.NOT_FOUND,
    },
  });
};
