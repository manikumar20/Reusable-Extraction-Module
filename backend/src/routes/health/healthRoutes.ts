import { Router } from "express";
import { handleGetHealthStatus } from "../../controllers/health/healthController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";

export const healthRouter = Router();

healthRouter.get("/", asyncHandler(handleGetHealthStatus));
