import axios from "axios";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { getDelegatedAccessToken } from "./msOAuth.js";
import type { OneDriveListedFile } from "./types.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_PREFIX = "odc_";
const MAX_DEPTH = 4;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

type DriveItem = {
  id?: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
  "@microsoft.graph.downloadUrl"?: string;
};

type DriveItemPage = {
  value?: DriveItem[];
  "@odata.nextLink"?: string;
};

export const isConnectedOneDriveToken = (value: string) => value.startsWith(TOKEN_PREFIX);

const sanitizeFileName = (name: string) => {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").replace(/^\.+/, "").trim() || "onedrive-file";
  return base.slice(0, 255);
};

const encodeToken = (driveId: string, itemId: string) =>
  TOKEN_PREFIX + Buffer.from(JSON.stringify({ d: driveId, i: itemId }), "utf8").toString("base64url");

const decodeToken = (token: string) => {
  if (!isConnectedOneDriveToken(token)) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
  try {
    const parsed = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8")) as {
      d?: unknown;
      i?: unknown;
    };
    const driveId = typeof parsed.d === "string" ? parsed.d : "";
    const itemId = typeof parsed.i === "string" ? parsed.i : "";
    if (!driveId || !itemId || /[/?#\s]/.test(driveId) || /[/?#\s]/.test(itemId)) {
      throw new Error("bad token");
    }
    return { driveId, itemId };
  } catch {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
};

const graphGet = async <T>(userId: number, pathOrUrl: string, responseType: "json" | "arraybuffer" = "json") => {
  const token = await getDelegatedAccessToken(userId);
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  try {
    const response = await axios.get<T>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: responseType === "json" ? "application/json" : "*/*",
      },
      responseType,
      timeout: responseType === "arraybuffer" ? 60_000 : 30_000,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 0;
      const message =
        (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message ||
        error.message;
      if (status === 401 || status === 403) {
        throw AppError(
          HTTP_STATUS.FORBIDDEN,
          "OneDrive access was denied. Reconnect OneDrive and ensure Files.Read permissions are granted.",
          { code: "ONEDRIVE_FORBIDDEN" },
        );
      }
      if (status === 404) {
        throw AppError(HTTP_STATUS.NOT_FOUND, "That OneDrive item was not found.", {
          code: "ONEDRIVE_NOT_FOUND",
        });
      }
      throw AppError(HTTP_STATUS.BAD_GATEWAY, message || "OneDrive request failed.", {
        code: "ONEDRIVE_REQUEST_FAILED",
      });
    }
    throw AppError(HTTP_STATUS.BAD_GATEWAY, "OneDrive request failed.", {
      code: "ONEDRIVE_REQUEST_FAILED",
    });
  }
};

const toListedFile = (item: DriveItem, driveId: string): OneDriveListedFile | null => {
  if (!item.id || !item.name || item.folder) return null;
  if (typeof item.size === "number" && item.size > MAX_FILE_BYTES) return null;
  return {
    id: encodeToken(driveId, item.id),
    name: sanitizeFileName(item.name),
    mimeType: item.file?.mimeType || "application/octet-stream",
    size: typeof item.size === "number" ? item.size : null,
    source: "onedrive",
  };
};

const listChildren = async (userId: number, driveId: string, itemId: string | null) => {
  const items: DriveItem[] = [];
  let next: string | null = itemId
    ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,size,file,folder,parentReference`
    : `/drives/${encodeURIComponent(driveId)}/root/children?$top=200&$select=id,name,size,file,folder,parentReference`;
  const seen = new Set<string>();

  while (next && !seen.has(next)) {
    seen.add(next);
    const page: DriveItemPage = await graphGet<DriveItemPage>(userId, next);
    items.push(...(page.value ?? []));
    const link: string | undefined = page["@odata.nextLink"];
    next = link || null;
  }
  return items;
};

const collectFiles = async (
  userId: number,
  driveId: string,
  itemId: string | null,
  depth: number,
  seen: Set<string>,
) => {
  const files: OneDriveListedFile[] = [];
  if (depth > MAX_DEPTH) return files;
  const key = itemId || "root";
  if (seen.has(key)) return files;
  seen.add(key);

  const children = await listChildren(userId, driveId, itemId);
  for (const child of children) {
    if (!child.id) continue;
    if (child.folder) {
      files.push(...(await collectFiles(userId, driveId, child.id, depth + 1, seen)));
      continue;
    }
    const listed = toListedFile(child, driveId);
    if (listed) files.push(listed);
  }
  return files;
};

export const listConnectedOneDriveFiles = async (userId: number, folderItemId?: string) => {
  const root = await graphGet<{ id?: string; parentReference?: { driveId?: string } }>(
    userId,
    "/me/drive?$select=id",
  );
  const driveId = root.id;
  if (!driveId) {
    throw AppError(HTTP_STATUS.BAD_GATEWAY, "Could not open your OneDrive.", {
      code: "ONEDRIVE_DRIVE_MISSING",
    });
  }

  const files = await collectFiles(userId, driveId, folderItemId || null, 0, new Set());
  if (!files.length) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "No files found in your OneDrive folder.", {
      code: "ONEDRIVE_EMPTY",
    });
  }
  return { kind: "folder" as const, files };
};

export const downloadConnectedOneDriveFile = async (userId: number, token: string) => {
  const { driveId, itemId } = decodeToken(token);
  const meta = await graphGet<DriveItem>(
    userId,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,folder`,
  );
  if (meta.folder) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive folders cannot be downloaded as a single file.", {
      code: "ONEDRIVE_IS_FOLDER",
    });
  }
  const listed = toListedFile(meta, driveId);
  if (!listed) {
    throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, "That OneDrive file is too large to import.", {
      code: "ONEDRIVE_FILE_TOO_LARGE",
    });
  }

  const direct = meta["@microsoft.graph.downloadUrl"];
  const buffer = Buffer.from(
    await graphGet<ArrayBuffer>(
      userId,
      direct ||
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
      "arraybuffer",
    ),
  );
  if (buffer.length > MAX_FILE_BYTES) {
    throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, "That OneDrive file is too large to import.", {
      code: "ONEDRIVE_FILE_TOO_LARGE",
    });
  }

  return {
    fileName: listed.name,
    mimeType: listed.mimeType,
    buffer,
  };
};
