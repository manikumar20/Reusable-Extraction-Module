import { Router } from "express";
import {
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleUpdateProfile,
} from "../../controllers/auth/authController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validate } from "../../validators/_shared/index.js";
import {
  loginBodySchema,
  registerBodySchema,
  updateProfileBodySchema,
} from "../../validators/auth/authValidators.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  validate({ body: registerBodySchema }),
  asyncHandler(handleRegister),
);

authRouter.post("/login", validate({ body: loginBodySchema }), asyncHandler(handleLogin));

authRouter.post("/logout", requireAuth, asyncHandler(handleLogout));

authRouter.get("/me", requireAuth, asyncHandler(handleMe));

authRouter.put(
  "/profile",
  requireAuth,
  validate({ body: updateProfileBodySchema }),
  asyncHandler(handleUpdateProfile),
);
