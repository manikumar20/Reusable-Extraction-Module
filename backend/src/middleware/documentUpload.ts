import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { HttpError } from "../utils/httpError.js";

const DOCUMENTS = [".pdf", ".txt", ".doc", ".docx", ".xls", ".xlsx"];
const IMAGES = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

export const DOCUMENT_EXTENSIONS = DOCUMENTS;
export const IMAGE_EXTENSIONS = IMAGES;
export const ALLOWED_EXTENSIONS = [...DOCUMENTS, ...IMAGES];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const uploadDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../uploads",
);

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const allowed = new Set(ALLOWED_EXTENSIONS);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const safe = path.basename(file.originalname).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    callback(null, `${randomUUID()}-${safe}`);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, callback) => {
  if (!allowed.has(extensionOf(file.originalname))) {
    callback(new HttpError(415, "Use a PDF, Word, Excel, text, or image file.", "UNSUPPORTED_FILE"));
    return;
  }
  callback(null, true);
};

export const uploadDocument = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter,
});

export const uploadSamples = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 3 },
  fileFilter,
});

/** Sample documents attached to a saved template (builder uploads). */
export const uploadTemplateDocuments = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
  fileFilter,
});
