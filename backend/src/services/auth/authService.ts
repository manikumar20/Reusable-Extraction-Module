import {
  createUser,
  findUserByEmail,
  findUserById,
  publicUserFromRow,
  updateUserProfile,
  verifyPassword,
  type PublicUser,
} from "../../db/users/userDb.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import type { LoginBody, RegisterBody, UpdateProfileBody } from "../../validators/auth/authValidators.js";
import { INVALID_CREDENTIALS_MESSAGE } from "./authConstants.js";
import { signAccessToken, type AuthTokenUser } from "./jwt.js";

export type AuthSession = {
  accessToken: string;
  user: PublicUser;
};

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "23505";

const issueSession = (user: PublicUser): AuthSession => ({
  accessToken: signAccessToken(user),
  user,
});

export const registerUser = async (input: RegisterBody): Promise<AuthSession> => {
  const existing = await findUserByEmail(input.email);
  if (existing) {
    throw AppError(HTTP_STATUS.CONFLICT, "An account with that email already exists.", {
      code: "EMAIL_TAKEN",
    });
  }

  try {
    const user = await createUser({
      email: input.email,
      password: input.password,
      name: input.name,
      organization: input.organization,
      role: input.role,
    });
    return issueSession(user);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError(HTTP_STATUS.CONFLICT, "An account with that email already exists.", {
        code: "EMAIL_TAKEN",
      });
    }
    throw error;
  }
};

export const loginWithEmail = async (email?: string, password?: string): Promise<AuthSession> => {
  const normalizedEmail = email?.trim()?.toLowerCase() ?? "";
  const normalizedPassword = password ?? "";

  if (!normalizedEmail || !normalizedPassword) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Email and password are required.", {
      code: "INVALID_LOGIN_BODY",
    });
  }

  const row = await findUserByEmail(normalizedEmail);
  if (!row || !(await verifyPassword(normalizedPassword, row.password_hash))) {
    throw AppError(HTTP_STATUS.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE, {
      code: "INVALID_CREDENTIALS",
    });
  }

  return issueSession(publicUserFromRow(row));
};

export const getMeFromAuthUser = async (authUser: AuthTokenUser): Promise<PublicUser> => {
  const row = await findUserById(authUser.sub);
  if (!row) {
    throw AppError(HTTP_STATUS.UNAUTHORIZED, "Unauthorized.", {
      code: "UNAUTHORIZED",
    });
  }
  return publicUserFromRow(row);
};

export const updateSessionUserProfile = async (
  userId: number,
  input: UpdateProfileBody,
): Promise<PublicUser> => {
  try {
    const user = await updateUserProfile(userId, {
      name: input.name,
      email: input.email,
      organization: input.organization ?? "",
      role: input.role ?? "Document reviewer",
    });
    if (!user) {
      throw AppError(HTTP_STATUS.NOT_FOUND, "User not found.", { code: "USER_NOT_FOUND" });
    }
    return user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError(HTTP_STATUS.CONFLICT, "An account with that email already exists.", {
        code: "EMAIL_TAKEN",
      });
    }
    throw error;
  }
};
