import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express, { type ErrorRequestHandler, type Request } from "express";
import multer from "multer";
import { HEADER_FIELDS, LINE_FIELDS } from "./extraction/shared/fields.js";
import {
  apiKey,
  createJob,
  documentModel,
  getJob,
  recordModel,
  runJob,
  subscribe,
} from "./runs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env"), override: true });

const uploadDir = path.resolve(here, "../uploads");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DOCUMENTS = [".pdf", ".txt", ".doc", ".docx", ".xls", ".xlsx"];
const IMAGES = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const ALLOWED = new Set([...DOCUMENTS, ...IMAGES]);

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const fail = (status: number, message: string, code: string) => ({
  error: { message, code, status },
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => {
      const safe = path.basename(file.originalname).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
      callback(null, `${randomUUID()}-${safe}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED.has(extensionOf(file.originalname))) {
      callback(new HttpError(415, "Use a PDF, Word, Excel, text, or image file.", "UNSUPPORTED_FILE"));
      return;
    }
    callback(null, true);
  },
});

const paramId = (req: Request) => {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id;
};

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  res.json({
    ready: Boolean(apiKey()),
    recordModel: recordModel(),
    documentModel: documentModel(),
    accept: [...ALLOWED],
    maxUploadMb: MAX_UPLOAD_BYTES / (1024 * 1024),
    maxImageMb: MAX_IMAGE_BYTES / (1024 * 1024),
  });
});

app.get("/api/catalog", (_req, res) => {
  res.json({ header: HEADER_FIELDS, lines: LINE_FIELDS });
});

app.post("/api/jobs", upload.single("file"), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) {
      res.status(400).json(fail(400, "Choose a file to extract.", "FILE_REQUIRED"));
      return;
    }

    const fileName = path.basename(file.originalname);
    if (IMAGES.includes(extensionOf(fileName)) && file.size > MAX_IMAGE_BYTES) {
      await fs.unlink(file.path).catch(() => undefined);
      res.status(413).json(fail(413, "Images must be 5 MB or smaller.", "IMAGE_TOO_LARGE"));
      return;
    }
    if (!apiKey()) {
      res.status(503).json(fail(503, "AI API key is not configured.", "CLAUDE_NOT_CONFIGURED"));
      return;
    }

    const job = createJob(fileName);
    void runJob(job.id, file.path, fileName);
    res.status(202).json({ id: job.id });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(paramId(req));
  if (!job) {
    res.status(404).json(fail(404, "Extraction job not found.", "NOT_FOUND"));
    return;
  }
  res.json(job);
});

app.get("/api/jobs/:id/events", (req, res) => {
  const id = paramId(req);
  if (!getJob(id)) {
    res.status(404).json(fail(404, "Extraction job not found.", "NOT_FOUND"));
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const closed = () => res.writableEnded || Boolean(res.socket?.destroyed);
  const send = () => {
    if (closed()) return;
    const job = getJob(id);
    if (!job) return;
    res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
  };
  const unsubscribe = subscribe(id, send);
  send();
  const beat = setInterval(() => {
    try {
      if (closed()) {
        clearInterval(beat);
        unsubscribe();
        return;
      }
      res.write(": ping\n\n");
    } catch {
      clearInterval(beat);
      unsubscribe();
    }
  }, 15_000);
  req.on("close", () => {
    clearInterval(beat);
    unsubscribe();
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json(fail(404, "Not found.", "NOT_FOUND"));
});

const webDist = path.resolve(here, "../../frontend/dist");
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) {
    next();
    return;
  }
  res.sendFile(path.join(webDist, "index.html"), (error) => {
    if (!error || res.headersSent) return;
    res.status(404).json(fail(404, "Not found.", "NOT_FOUND"));
  });
});

const onError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json(fail(413, "File is larger than 25 MB.", "FILE_TOO_LARGE"));
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json(fail(error.status, error.message, error.code));
    return;
  }
  const message = error instanceof Error ? error.message : "Request failed.";
  console.error(message);
  res.status(500).json(fail(500, message, "REQUEST_FAILED"));
};
app.use(onError);

const portValue = Number(process.env.PORT);
const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 8787;

await fs.mkdir(uploadDir, { recursive: true });
const server = app.listen(port, () => {
  console.log(`Extraction API listening on http://127.0.0.1:${port}`);
  console.log(`Uploads folder: ${uploadDir}`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  const message =
    error.code === "EADDRINUSE" ? `Port ${port} is already in use.` : error.message;
  console.error(message);
  process.exit(1);
});
