import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { open as openZip, type Entry, type ZipFile } from "yauzl";
import { compressedDir, temporaryDir } from "../../config/storage.js";
import { ALLOWED_EXTENSIONS, IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES } from "../../middleware/documentUpload.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

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

export type UploadedDiskFile = {
  originalname: string;
  path: string;
  size: number;
  mimetype?: string;
};

export type ZipBatchResult = {
  batchId: string;
  zipFileName: string;
  zipFilePath: string;
  zipSizeBytes: number;
  originalNames: string[];
};

const MAX_ZIP_ENTRIES = 50;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

export const validateUploadFiles = (files: UploadedDiskFile[]) => {
  if (!files.length) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Choose at least one file to upload.", {
      code: "FILES_REQUIRED",
    });
  }
  if (files.length > MAX_ZIP_ENTRIES) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, `Upload at most ${MAX_ZIP_ENTRIES} files per batch.`, {
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
    if (file.size > MAX_UPLOAD_BYTES) {
      throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, `${name} is larger than 25 MB.`, {
        code: "FILE_TOO_LARGE",
      });
    }
    if (IMAGE_EXTENSIONS.includes(ext) && file.size > MAX_IMAGE_BYTES) {
      throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, `${name} must be 5 MB or smaller.`, {
        code: "IMAGE_TOO_LARGE",
      });
    }
  }
};

/** Compress uploaded disk files into storage/compressed/batch_<id>.zip, then delete originals. */
export const compressUploadsToZip = async (files: UploadedDiskFile[]): Promise<ZipBatchResult> => {
  validateUploadFiles(files);
  const batchId = randomUUID();
  const zipFileName = `batch_${batchId}.zip`;
  const zipFilePath = path.join(compressedDir, zipFileName);
  const originalNames = files.map((file) => safeEntryName(file.originalname));

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipFilePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    const used = new Set<string>();
    for (const [index, file] of files.entries()) {
      let entry = originalNames[index]!;
      if (used.has(entry.toLowerCase())) {
        const ext = extensionOf(entry);
        const stem = ext ? entry.slice(0, -ext.length) : entry;
        entry = `${stem}_${index + 1}${ext}`;
        originalNames[index] = entry;
      }
      used.add(entry.toLowerCase());
      archive.file(file.path, { name: entry });
    }
    void archive.finalize();
  });

  await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));

  const stat = await fs.stat(zipFilePath);
  return {
    batchId,
    zipFileName,
    zipFilePath,
    zipSizeBytes: stat.size,
    originalNames,
  };
};

export type ZipEntryFile = {
  originalName: string;
  tempPath: string;
  size: number;
};

/** Stream each ZIP entry to a temp file (one at a time). Caller must unlink tempPath. */
export const forEachZipEntry = async (
  zipFilePath: string,
  handler: (entry: ZipEntryFile) => Promise<void>,
) => {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    openZip(zipFilePath, { lazyEntries: true, autoClose: true }, (error: Error | null, file?: ZipFile) => {
      if (error || !file) {
        reject(
          AppError(HTTP_STATUS.BAD_REQUEST, "Compressed batch is missing or corrupted.", {
            code: "ZIP_CORRUPT",
          }),
        );
        return;
      }
      resolve(file);
    });
  });

  let entries = 0;
  let uncompressedTotal = 0;

  await new Promise<void>((resolve, reject) => {
    zip.readEntry();
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        try {
          const name = entry.fileName.replace(/\\/g, "/");
          if (name.endsWith("/")) {
            zip.readEntry();
            return;
          }
          if (name.includes("..") || path.isAbsolute(name)) {
            throw AppError(HTTP_STATUS.BAD_REQUEST, "Upload contains an unsafe path.", {
              code: "ZIP_PATH_TRAVERSAL",
            });
          }
          entries += 1;
          if (entries > MAX_ZIP_ENTRIES) {
            throw AppError(HTTP_STATUS.BAD_REQUEST, "Batch contains too many files.", {
              code: "ZIP_TOO_MANY_ENTRIES",
            });
          }
          uncompressedTotal += entry.uncompressedSize;
          if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
            throw AppError(HTTP_STATUS.BAD_REQUEST, "Batch uncompressed size is too large.", {
              code: "ZIP_BOMB",
            });
          }
          const originalName = safeEntryName(name);
          const ext = extensionOf(originalName);
          if (!ALLOWED_EXTENSIONS.includes(ext)) {
            zip.readEntry();
            return;
          }

          const tempPath = path.join(temporaryDir, `${randomUUID()}-${originalName}`);
          await new Promise<void>((res, rej) => {
            zip.openReadStream(entry, (error: Error | null, readStream?: Readable) => {
              if (error || !readStream) {
                rej(error ?? new Error("Unable to read archive entry."));
                return;
              }
              const write = createWriteStream(tempPath);
              pipeline(readStream, write).then(() => res()).catch(rej);
            });
          });

          try {
            await handler({
              originalName,
              tempPath,
              size: entry.uncompressedSize,
            });
          } finally {
            await fs.unlink(tempPath).catch(() => undefined);
          }
          zip.readEntry();
        } catch (error) {
          zip.close();
          reject(error);
        }
      })();
    });
    zip.on("end", () => resolve());
    zip.on("error", reject);
  });

  if (entries === 0) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Batch has no extractable files.", { code: "ZIP_EMPTY" });
  }
};
