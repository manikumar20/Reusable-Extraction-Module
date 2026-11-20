import { promisify } from "node:util";
import { gzip } from "node:zlib";
import path from "node:path";
import { ALLOWED_EXTENSIONS } from "../../middleware/documentUpload.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

const gzipBuffer = promisify(gzip);

const MAX_FILES = 50;

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const safeEntryName = (name: string) => {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[<>:"|?*\u0000-\u001f]/g, "_");
  if (!base || base === "." || base === "..") {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Upload contains an unsafe file name.", {
      code: "ZIP_UNSAFE_NAME",
    });
  }
  return base;
};

export type UploadedMemoryFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype?: string;
};

export const validateUploadFiles = (files: UploadedMemoryFile[]) => {
  if (!files.length) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Choose at least one file to upload.", {
      code: "FILES_REQUIRED",
    });
  }
  if (files.length > MAX_FILES) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, `Upload at most ${MAX_FILES} files at a time.`, {
      code: "TOO_MANY_FILES",
    });
  }
  const allowed = new Set(ALLOWED_EXTENSIONS);
  for (const file of files) {
    const name = path.basename(file.originalname);
    const ext = extensionOf(name);
    if (!allowed.has(ext)) {
      throw AppError(HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE, `Unsupported file type: ${name}`, {
        code: "UNSUPPORTED_FILE",
      });
    }
  }
};

/** Gzip the uploaded bytes. The caller stores that buffer in the database. */
export const gzipUpload = async (file: UploadedMemoryFile) => {
  validateUploadFiles([file]);
  const originalName = safeEntryName(file.originalname);
  const fileData = await gzipBuffer(file.buffer, { level: 9 });
  return { originalName, fileData, sizeBytes: fileData.length };
};
