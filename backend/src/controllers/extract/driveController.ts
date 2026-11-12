import type { Request, Response } from "express";
import { downloadDriveFile, listDriveFiles } from "../../services/drive/googleDrive.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

export const handleListDrive = async (request: Request, response: Response) => {
  const url =
    request.body && typeof request.body === "object" && typeof (request.body as { url?: unknown }).url === "string"
      ? (request.body as { url: string }).url.trim()
      : "";
  if (!url) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Paste a Google Drive folder or file link.", {
      code: "DRIVE_URL_REQUIRED",
    });
  }
  const result = await listDriveFiles(url);
  response.json(result);
};

export const handleDownloadDriveFile = async (request: Request, response: Response) => {
  const fileId = String(request.params.fileId || "").trim();
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Drive file id is invalid.", {
      code: "DRIVE_FILE_ID_INVALID",
    });
  }
  const resourceKey =
    typeof request.query.resourceKey === "string" ? request.query.resourceKey.trim() : undefined;
  const file = await downloadDriveFile(fileId, resourceKey || undefined);
  response.setHeader("Content-Type", file.mimeType);
  response.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  response.setHeader("X-File-Name", encodeURIComponent(file.fileName));
  response.send(file.buffer);
};
