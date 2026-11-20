import multer from "multer";
import { HttpError } from "../utils/httpError.js";

const DOCUMENTS = [".pdf", ".txt", ".doc", ".docx", ".xls", ".xlsx", ".csv"];
const IMAGES = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

export const DOCUMENT_EXTENSIONS = DOCUMENTS;
export const IMAGE_EXTENSIONS = IMAGES;
export const ALLOWED_EXTENSIONS = [...DOCUMENTS, ...IMAGES];

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const allowed = new Set(ALLOWED_EXTENSIONS);

const fileFilter: multer.Options["fileFilter"] = (_req, file, callback) => {
  if (!allowed.has(extensionOf(file.originalname))) {
    callback(new HttpError(415, "Use a PDF, Word, Excel, text, or image file.", "UNSUPPORTED_FILE"));
    return;
  }
  callback(null, true);
};

const memory = multer.memoryStorage();

export const uploadDocument = multer({
  storage: memory,
  limits: { files: 1 },
  fileFilter,
});

export const uploadSamples = multer({
  storage: memory,
  limits: { files: 3 },
  fileFilter,
});

/** Sample documents attached to a saved template (builder uploads). */
export const uploadTemplateDocuments = multer({
  storage: memory,
  limits: { files: 10 },
  fileFilter,
});

/** Multi-file upload. Each file is gzip-compressed into the database. */
export const uploadBatchFiles = multer({
  storage: memory,
  limits: { files: 50 },
  fileFilter,
});
