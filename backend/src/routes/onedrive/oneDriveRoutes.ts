import { Router } from "express";
import {
  handleDownloadConnectedOneDrive,
  handleListConnectedOneDrive,
  handleListOneDriveShareLink,
  handleOneDriveAuthUrl,
  handleOneDriveCallback,
  handleOneDriveDisconnect,
  handleOneDriveStatus,
} from "../../controllers/onedrive/oneDriveController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

export const oneDriveRouter = Router();

/** Microsoft redirects here without our JWT — do not require auth. */
oneDriveRouter.get("/callback", asyncHandler(handleOneDriveCallback));

oneDriveRouter.get("/auth-url", requireAuth, asyncHandler(handleOneDriveAuthUrl));
oneDriveRouter.get("/status", requireAuth, asyncHandler(handleOneDriveStatus));
oneDriveRouter.delete("/disconnect", requireAuth, asyncHandler(handleOneDriveDisconnect));
oneDriveRouter.get("/files", requireAuth, asyncHandler(handleListConnectedOneDrive));
oneDriveRouter.post("/share/list", requireAuth, asyncHandler(handleListOneDriveShareLink));
oneDriveRouter.get("/files/:fileId", requireAuth, asyncHandler(handleDownloadConnectedOneDrive));
