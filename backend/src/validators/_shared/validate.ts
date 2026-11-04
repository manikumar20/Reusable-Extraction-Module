import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodTypeAny } from "zod";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

type RequestSchemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

const validationMessage = (error: unknown) => {
  if (!(error instanceof ZodError) || error.issues.length === 0) {
    return "Validation failed";
  }
  return error.issues[0]?.message || "Validation failed";
};

export const validate = (schemas: RequestSchemas) => {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        request.body = schemas.body.parse(request.body);
      }
      if (schemas.params) {
        request.params = schemas.params.parse(request.params) as typeof request.params;
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(request.query);
        // Express types query as ParsedQs; assign parsed (transformed) values for handlers.
        Object.assign(request.query, parsed);
      }
      next();
    } catch (error) {
      const details =
        error instanceof ZodError
          ? {
              issues: error.issues.map((issue) => ({
                path: issue.path,
                message: issue.message,
              })),
            }
          : error;

      next(
        AppError(HTTP_STATUS.BAD_REQUEST, validationMessage(error), {
          code: "VALIDATION_ERROR",
          details,
        }),
      );
    }
  };
};
