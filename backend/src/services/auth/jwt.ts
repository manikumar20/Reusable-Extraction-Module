import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { PublicUser } from "../../db/users/userDb.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

type TokenPayload = {
  sub?: string | number;
  email?: string;
  name?: string;
  iat?: number;
  exp?: number;
};

export type AuthTokenUser = {
  sub: number;
  email: string;
  name: string;
};

export const signAccessToken = (user: Pick<PublicUser, "id" | "email" | "name">): string =>
  jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      name: user.name,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] },
  );

export const verifyAccessToken = (token: string): AuthTokenUser => {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    const sub = Number(payload.sub);
    if (!Number.isInteger(sub) || sub < 1 || !payload.email) {
      throw AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid token.", {
        code: "INVALID_TOKEN",
      });
    }
    return {
      sub,
      email: payload.email,
      name: payload.name ?? "",
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    throw AppError(HTTP_STATUS.UNAUTHORIZED, "Unauthorized.", {
      code: "UNAUTHORIZED",
    });
  }
};
