import { Router } from "express";
import { authRouter } from "./auth/authRoutes.js";
import { batchRouter } from "./batches/batchRoutes.js";
import { documentRouter } from "./documents/documentRoutes.js";
import { extractRouter } from "./extract/extractRoutes.js";
import { healthRouter } from "./health/healthRoutes.js";
import { templateRouter } from "./templates/templateRoutes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/documents", documentRouter);
apiRouter.use("/extract", extractRouter);
apiRouter.use("/batches", batchRouter);
apiRouter.use("/templates", templateRouter);
