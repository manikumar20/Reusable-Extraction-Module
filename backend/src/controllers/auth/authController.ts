import type { Request, Response } from "express";
import { getAuthUser } from "../../middleware/auth.middleware.js";
import {
  getMeFromAuthUser,
  loginWithEmail,
  registerUser,
  updateSessionUserProfile,
} from "../../services/auth/authService.js";
import { HTTP_STATUS } from "../../utils/errors/index.js";
import type {
  LoginBody,
  RegisterBody,
  UpdateProfileBody,
} from "../../validators/auth/authValidators.js";

export const handleRegister = async (request: Request, response: Response) => {
  const body = request.body as RegisterBody;
  const result = await registerUser(body);
  response.status(HTTP_STATUS.CREATED).json(result);
};

export const handleLogin = async (request: Request, response: Response) => {
  const { email, password } = request.body as LoginBody;
  response.json(await loginWithEmail(email, password));
};

export const handleLogout = (_request: Request, response: Response) => {
  response.status(HTTP_STATUS.NO_CONTENT).send();
};

export const handleMe = async (request: Request, response: Response) => {
  const authUser = getAuthUser(request);
  const user = await getMeFromAuthUser(authUser);
  response.json({ user });
};

export const handleUpdateProfile = async (request: Request, response: Response) => {
  const authUser = getAuthUser(request);
  const body = request.body as UpdateProfileBody;
  const user = await updateSessionUserProfile(authUser.sub, body);
  response.json({ user });
};
