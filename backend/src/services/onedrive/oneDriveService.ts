import { AppError, HTTP_STATUS, isAppError } from "../../utils/errors/index.js";
import { encodeSharingUrl } from "../../utils/onedrive/encodeSharingUrl.js";
import { isOneDriveUrl } from "../../utils/onedrive/identifyLinkType.js";
import { GRAPH_BASE_URL, graphGet } from "./graphClient.js";
import { downloadByDriveItem, downloadByShareItem, MAX_FILE_BYTES } from "./oneDriveDownloadService.js";
import { getFolderChildren, getShareChildren } from "./oneDriveFolderService.js";
import { requireMsGraphConfig } from "./msGraphAuth.js";
import type { GraphDriveItem, OneDriveListedFile } from "./types.js";

const TOKEN_PREFIX = "od_";
const MAX_DEPTH = 4;
const MAX_SHARE_URL_CHARS = 900;

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export { isOneDriveUrl };
export const isOneDriveToken = (value: string) => value.startsWith(TOKEN_PREFIX);

const hostOf = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const isTrustedMicrosoftHost = (hostname: string) => {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return (
    host === "1drv.ms" ||
    host === "onedrive.live.com" ||
    host.endsWith(".1drv.com") ||
    host.endsWith(".svc.ms") ||
    host.endsWith(".onedrive.com") ||
    host.endsWith(".live.com") ||
    host.endsWith(".live.net") ||
    host.endsWith(".office.com") ||
    host.endsWith(".office.net") ||
    host.endsWith(".microsoft.com") ||
    host.endsWith(".microsoftpersonalcontent.com") ||
    host.endsWith(".sharepointonline.com") ||
    host.endsWith(".sharepoint.com") ||
    host.endsWith(".sharepoint.us") ||
    host.endsWith(".sharepoint.de") ||
    host.endsWith(".sharepoint.cn")
  );
};

const stripHash = (value: string) => value.trim().split("#")[0];

const cleanShareUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(stripHash(value));
  } catch {
    return stripHash(value);
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|mc_|ref$|referrer$|ga$|reauth$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
};

const compactShareUrl = (value: string) => {
  const cleaned = cleanShareUrl(value);
  if (cleaned.length <= MAX_SHARE_URL_CHARS) return cleaned;
  try {
    const url = new URL(cleaned);
    url.hash = "";
    url.search = "";
    if (url.toString().length <= MAX_SHARE_URL_CHARS && isOneDriveUrl(url.toString())) {
      return url.toString();
    }
  } catch {
    /* ignore */
  }
  return cleaned.slice(0, MAX_SHARE_URL_CHARS);
};

const sharePath = (shareUrl: string) =>
  `/shares/${encodeURIComponent(encodeSharingUrl(shareUrl))}`;

const sanitizeFileName = (name: string) => {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").replace(/^\.+/, "").trim() || "onedrive-file";
  return base.slice(0, 255);
};

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const withExtension = (name: string, mimeType: string) => {
  const safe = sanitizeFileName(name);
  if (extensionOf(safe)) return safe;
  const extension = MIME_EXTENSION[mimeType];
  return extension ? `${safe}${extension}` : safe;
};

type FileToken = {
  u: string;
  i: string;
  d?: string;
};

const encodeToken = (shareUrl: string, itemId: string, driveId?: string) =>
  TOKEN_PREFIX +
  Buffer.from(JSON.stringify({ u: shareUrl, i: itemId, ...(driveId ? { d: driveId } : {}) }), "utf8").toString(
    "base64url",
  );

const decodeToken = (token: string): FileToken => {
  if (!isOneDriveToken(token)) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
  let parsed: { u?: unknown; i?: unknown; d?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8")) as {
      u?: unknown;
      i?: unknown;
      d?: unknown;
    };
  } catch {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
  const shareUrl = typeof parsed.u === "string" ? parsed.u : "";
  const itemId = typeof parsed.i === "string" ? parsed.i : "";
  const driveId = typeof parsed.d === "string" ? parsed.d : undefined;
  if (!isOneDriveUrl(shareUrl) || !itemId || itemId.length > 512 || /[/?#\s]/.test(itemId)) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
  if (driveId && (driveId.length > 512 || /[/?#\s]/.test(driveId))) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
  return { u: shareUrl, i: itemId, d: driveId };
};

const toListedFile = (item: GraphDriveItem, shareUrl: string): OneDriveListedFile | null => {
  if (!item.id || !item.name || item.folder) return null;
  if (typeof item.size === "number" && item.size > MAX_FILE_BYTES) return null;
  const mimeType = item.file?.mimeType || "application/octet-stream";
  return {
    id: encodeToken(shareUrl, item.id, item.parentReference?.driveId),
    name: withExtension(item.name, mimeType),
    mimeType,
    size: typeof item.size === "number" ? item.size : null,
    source: "onedrive",
  };
};

const resolveShortLink = async (shareUrl: string) => {
  if (hostOf(shareUrl) !== "1drv.ms") return shareUrl;
  let current = cleanShareUrl(shareUrl);
  for (let hop = 0; hop < 5; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html,*/*", "User-Agent": "ExtractIQ/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      break;
    }
    const location = response.headers.get("location");
    if (!location) break;
    const next = new URL(location, current).toString();
    if (/login\.(live|microsoftonline)|account\.live|microsoftonline\.com\//i.test(next)) {
      return current;
    }
    if (!isTrustedMicrosoftHost(hostOf(next))) {
      throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive short link redirected to an untrusted host.", {
        code: "ONEDRIVE_REDIRECT_UNTRUSTED",
      });
    }
    if (!isOneDriveUrl(next) && !hostOf(next).endsWith(".live.com")) return current;
    current = cleanShareUrl(next);
  }
  return current;
};

const shareCandidates = async (rawUrl: string) => {
  const original = cleanShareUrl(rawUrl);
  const candidates: string[] = [];
  const add = (value: string) => {
    const next = compactShareUrl(value);
    if (next && isOneDriveUrl(next) && !candidates.includes(next)) candidates.push(next);
  };
  add(original);
  if (hostOf(original) === "1drv.ms") add(await resolveShortLink(original));
  try {
    const url = new URL(original);
    url.hash = "";
    add(`${url.origin}${url.pathname}`);
  } catch {
    /* ignore */
  }
  candidates.sort((a, b) => a.length - b.length);
  return candidates;
};

export const getSharedItem = async (sharingUrl: string) => {
  const path = `${sharePath(sharingUrl)}/driveItem?$select=id,name,size,file,folder,parentReference`;
  return graphGet<GraphDriveItem>(path);
};

const openShare = async (rawUrl: string) => {
  const candidates = await shareCandidates(rawUrl);
  let lastError: AppError | null = null;
  for (const shareUrl of candidates) {
    try {
      const item = await getSharedItem(shareUrl);
      return { shareUrl, item };
    } catch (error) {
      if (isAppError(error)) {
        lastError = error;
        if (
          error.code === "ONEDRIVE_NOT_FOUND" ||
          error.code === "ONEDRIVE_FORBIDDEN" ||
          error.code === "ONEDRIVE_REQUEST_FAILED"
        ) {
          continue;
        }
      }
      throw error;
    }
  }
  throw (
    lastError ??
    AppError(HTTP_STATUS.BAD_REQUEST, "That OneDrive/SharePoint link could not be opened.", {
      code: "ONEDRIVE_NOT_FOUND",
    })
  );
};

const collectFiles = async (
  shareUrl: string,
  itemId: string | null,
  driveId: string | undefined,
  depth: number,
  seen: Set<string>,
) => {
  const files: OneDriveListedFile[] = [];
  const skipped: string[] = [];
  if (depth > MAX_DEPTH) return { files, skipped };
  const key = itemId || "root";
  if (seen.has(key)) return { files, skipped };
  seen.add(key);

  const children =
    driveId && itemId
      ? await getFolderChildren(driveId, itemId)
      : await getShareChildren(sharePath(shareUrl), itemId);

  for (const child of children) {
    if (!child.id || !child.name) continue;
    if (child.folder) {
      const nested = await collectFiles(
        shareUrl,
        child.id,
        child.parentReference?.driveId || driveId,
        depth + 1,
        seen,
      );
      files.push(...nested.files);
      skipped.push(...nested.skipped);
      continue;
    }
    const listed = toListedFile(child, shareUrl);
    if (listed) files.push(listed);
    else skipped.push(`"${child.name}" (too large)`);
  }
  return { files, skipped };
};

export const listOneDriveFiles = async (rawUrl: string) => {
  requireMsGraphConfig();
  const trimmed = rawUrl.trim();
  if (!isOneDriveUrl(trimmed)) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Paste a valid OneDrive or SharePoint file or folder link.", {
      code: "ONEDRIVE_URL_INVALID",
    });
  }

  const opened = await openShare(trimmed);
  const shareUrl = opened.shareUrl;
  const driveId = opened.item.parentReference?.driveId;

  if (!opened.item.folder) {
    const listed = toListedFile(opened.item, shareUrl);
    if (!listed) {
      throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, "That OneDrive file is too large to import.", {
        code: "ONEDRIVE_FILE_TOO_LARGE",
      });
    }
    return { kind: "file" as const, files: [listed] };
  }

  const { files, skipped } = await collectFiles(
    shareUrl,
    driveId ? opened.item.id || null : null,
    driveId,
    0,
    new Set(),
  );
  if (!files.length) {
    const sample = [...new Set(skipped)].slice(0, 4).join("; ");
    throw AppError(
      HTTP_STATUS.NOT_FOUND,
      sample ? `No importable files found. Skipped: ${sample}.` : "No files found in that OneDrive folder.",
      { code: "ONEDRIVE_EMPTY" },
    );
  }
  return { kind: "folder" as const, files };
};

export const downloadOneDriveFile = async (token: string) => {
  requireMsGraphConfig();
  const { u: shareUrl, i: itemId, d: driveId } = decodeToken(token);

  const meta = driveId
    ? await graphGet<GraphDriveItem>(
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,folder,parentReference`,
      )
    : await graphGet<GraphDriveItem>(
        `${sharePath(shareUrl)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,folder,parentReference`,
      );

  if (meta.folder) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive folders cannot be downloaded as a single file.", {
      code: "ONEDRIVE_IS_FOLDER",
    });
  }

  const listed = toListedFile(meta, shareUrl);
  if (!listed) {
    throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, "That OneDrive file is too large to import.", {
      code: "ONEDRIVE_FILE_TOO_LARGE",
    });
  }

  const buffer = driveId
    ? await downloadByDriveItem(driveId, itemId)
    : await downloadByShareItem(sharePath(shareUrl), itemId);

  return {
    fileName: listed.name,
    mimeType: listed.mimeType || "application/octet-stream",
    buffer,
  };
};

/** Kept for diagnostics / future use. */
export const graphBaseUrl = GRAPH_BASE_URL;
