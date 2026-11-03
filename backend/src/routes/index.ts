import { Router } from "express";
import { catalogRouter } from "./catalog/catalogRoutes.js";
import { documentRouter } from "./documents/documentRoutes.js";
import { healthRouter } from "./health/healthRoutes.js";
import { jobRouter } from "./jobs/jobRoutes.js";
import { templateRouter } from "./templates/templateRoutes.js";

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(catalogRouter);
apiRouter.use("/documents", documentRouter);
apiRouter.use("/jobs", jobRouter);
apiRouter.use("/templates", templateRouter);
