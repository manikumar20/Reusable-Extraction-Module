import type { Request, Response } from "express";
import { getAuthUser } from "../../middleware/auth.middleware.js";
import {
  downloadConnectedOneDriveFile,
  isConnectedOneDriveToken,
  listConnectedOneDriveFiles,
} from "../../services/onedrive/connectedDriveService.js";
import {
  downloadShareLinkWithConnectedAccount,
  isDelegatedShareToken,
  listShareLinkWithConnectedAccount,
} from "../../services/onedrive/connectedShareService.js";
import {
  buildOneDriveAuthUrl,
  completeOneDriveOAuth,
  disconnectOneDrive,
  frontendRedirectAfterOAuth,
  getOneDriveStatus,
} from "../../services/onedrive/msOAuth.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

export const handleOneDriveAuthUrl = async (request: Request, response: Response) => {
  const user = getAuthUser(request);
  const url = buildOneDriveAuthUrl(user.sub);
  response.json({ url });
};

export const handleOneDriveCallback = async (request: Request, response: Response) => {
  const error = typeof request.query.error === "string" ? request.query.error : "";
  const errorDescription =
    typeof request.query.error_description === "string" ? request.query.error_description : "";
  if (error) {
    response.redirect(frontendRedirectAfterOAuth(false, errorDescription || error));
    return;
  }

  const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
  const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
  if (!code || !state) {
    response.redirect(frontendRedirectAfterOAuth(false, "Missing Microsoft authorization code."));
    return;
  }

  try {
    await completeOneDriveOAuth(code, state);
    response.redirect(frontendRedirectAfterOAuth(true));
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : "OneDrive connection failed.";
    response.redirect(frontendRedirectAfterOAuth(false, message));
  }
};

export const handleOneDriveStatus = async (request: Request, response: Response) => {
  const user = getAuthUser(request);
  response.json(await getOneDriveStatus(user.sub));
};

export const handleOneDriveDisconnect = async (request: Request, response: Response) => {
  const user = getAuthUser(request);
  await disconnectOneDrive(user.sub);
  response.json({ connected: false });
};

export const handleListConnectedOneDrive = async (request: Request, response: Response) => {
  const user = getAuthUser(request);
  const folderId =
    typeof request.query.folderId === "string" && request.query.folderId.trim()
      ? request.query.folderId.trim()
      : undefined;
  const result = await listConnectedOneDriveFiles(user.sub, folderId);
  response.json(result);
};

export const handleListOneDriveShareLink = async (request: Request, response: Response) => {
  const user = getAuthUser(request);
  const url =
    request.body && typeof request.body === "object" && typeof (request.body as { url?: unknown }).url === "string"
      ? (request.body as { url: string }).url.trim()
      : "";
  if (!url) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Paste a OneDrive or SharePoint link.", {
      code: "ONEDRIVE_URL_REQUIRED",
    });
  }
  const result = await listShareLinkWithConnectedAccount(user.sub, url);
  response.json(result);
};

export const handleDownloadConnectedOneDrive = async (request: Request, response: Response) => {
  const user = getAuthUser(request);
  const fileId = String(request.params.fileId || "").trim();
  if (!fileId) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is required.", {
      code: "ONEDRIVE_FILE_ID_REQUIRED",
    });
  }
  const file = isDelegatedShareToken(fileId)
    ? await downloadShareLinkWithConnectedAccount(user.sub, fileId)
    : isConnectedOneDriveToken(fileId)
      ? await downloadConnectedOneDriveFile(user.sub, fileId)
      : (() => {
          throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
            code: "ONEDRIVE_FILE_ID_INVALID",
          });
        })();
  response.setHeader("Content-Type", file.mimeType);
  response.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  response.setHeader("X-File-Name", encodeURIComponent(file.fileName));
  response.send(file.buffer);
};
