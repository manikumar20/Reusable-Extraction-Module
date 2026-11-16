import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type AuthTokenUser } from "../services/auth/jwt.js";
import { AppError, HTTP_STATUS, isAppError } from "../utils/errors/index.js";
import { extractBearerToken } from "./bearerToken.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthTokenUser;
    }
  }
}

const attachAuthUser = (request: Request) => {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    throw AppError(HTTP_STATUS.UNAUTHORIZED, "Unauthorized.", {
      code: "UNAUTHORIZED",
    });
  }
  request.authUser = verifyAccessToken(token);
};

const forwardAuthError = (error: unknown, next: NextFunction) => {
  if (isAppError(error)) {
    next(error);
    return;
  }
  next(
    AppError(HTTP_STATUS.UNAUTHORIZED, "Unauthorized.", {
      code: "UNAUTHORIZED",
    }),
  );
};

export const getAuthUser = (request: Request): AuthTokenUser => {
  if (!request.authUser) {
    throw AppError(HTTP_STATUS.UNAUTHORIZED, "Unauthorized.", {
      code: "UNAUTHORIZED",
    });
  }
  return request.authUser;
};

export const requireAuth = (request: Request, _response: Response, next: NextFunction) => {
  try {
    attachAuthUser(request);
    next();
  } catch (error) {
    forwardAuthError(error, next);
  }
};
