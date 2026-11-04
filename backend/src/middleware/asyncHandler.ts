import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4-safe wrapper so async controller errors reach errorHandler. */
export const asyncHandler =
  (
    handler: (req: Request, res: Response, next: NextFunction) => unknown,
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
