import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { apiRouter } from "./routes/index.js";
import { HTTP_STATUS } from "./utils/errors/index.js";

export { apiKey, documentModel, recordModel } from "./config/runtime.js";
export {
  createJob,
  getJob,
  runJob,
  subscribe,
  type JobPhase,
  type JobTemplate,
  type PublicJob,
} from "./services/extract/extractService.js";

const REQUEST_BODY_LIMIT = "2mb";

export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const normalized = origin.replace(/\/$/, "");
        if (env.corsOrigins.includes(normalized)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept"],
      optionsSuccessStatus: HTTP_STATUS.NO_CONTENT,
    }),
  );
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", apiRouter);
  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
};
