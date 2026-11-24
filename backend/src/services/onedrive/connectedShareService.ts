import axios from "axios";
import { AppError, HTTP_STATUS, isAppError } from "../../utils/errors/index.js";
import { encodeSharingUrl } from "../../utils/onedrive/encodeSharingUrl.js";
import { isOneDriveUrl } from "../../utils/onedrive/identifyLinkType.js";
import { getDelegatedAccessToken } from "./msOAuth.js";
import type { GraphDriveItem, GraphDriveItemPage, OneDriveListedFile } from "./types.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_PREFIX = "ods_";
const MAX_DEPTH = 4;
const MAX_SHARE_URL_CHARS = 900;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const isDelegatedShareToken = (value: string) => value.startsWith(TOKEN_PREFIX);

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
  return (
    host === "1drv.ms" ||
    host === "onedrive.live.com" ||
    host === "graph.microsoft.com" ||
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

const sanitizeFileName = (name: string) => {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").replace(/^\.+/, "").trim() || "onedrive-file";
  return base.slice(0, 255);
};

const sharePath = (shareUrl: string) => `/shares/${encodeURIComponent(encodeSharingUrl(shareUrl))}`;

const encodeToken = (shareUrl: string, itemId: string, driveId?: string) =>
  TOKEN_PREFIX +
  Buffer.from(JSON.stringify({ u: shareUrl, i: itemId, ...(driveId ? { d: driveId } : {}) }), "utf8").toString(
    "base64url",
  );

const decodeToken = (token: string) => {
  if (!isDelegatedShareToken(token)) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
  try {
    const parsed = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8")) as {
      u?: unknown;
      i?: unknown;
      d?: unknown;
    };
    const shareUrl = typeof parsed.u === "string" ? parsed.u : "";
    const itemId = typeof parsed.i === "string" ? parsed.i : "";
    const driveId = typeof parsed.d === "string" ? parsed.d : undefined;
    if (!isOneDriveUrl(shareUrl) || !itemId || itemId.length > 512 || /[/?#\s]/.test(itemId)) {
      throw new Error("bad");
    }
    return { shareUrl, itemId, driveId };
  } catch {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive file id is invalid.", {
      code: "ONEDRIVE_FILE_ID_INVALID",
    });
  }
};

const mapError = (error: unknown) => {
  if (isAppError(error)) return error;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status || 0;
    const message =
      (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message || error.message;
    if (status === 401 || status === 403 || /accessdenied|forbidden|do not have permission/i.test(message)) {
      return AppError(
        HTTP_STATUS.FORBIDDEN,
        "That OneDrive link is not accessible with your connected Microsoft account. Open the link in the browser while signed in, or use a link shared with you.",
        { code: "ONEDRIVE_FORBIDDEN" },
      );
    }
    if (status === 404 || /not found|sharing link no longer exists/i.test(message)) {
      return AppError(
        HTTP_STATUS.BAD_REQUEST,
        "That OneDrive link could not be opened. Confirm it is valid and not expired.",
        { code: "ONEDRIVE_NOT_FOUND" },
      );
    }
    return AppError(HTTP_STATUS.BAD_GATEWAY, message || "OneDrive request failed.", {
      code: "ONEDRIVE_REQUEST_FAILED",
    });
  }
  return AppError(HTTP_STATUS.BAD_GATEWAY, "OneDrive request failed.", {
    code: "ONEDRIVE_REQUEST_FAILED",
  });
};

const graphGet = async <T>(
  userId: number,
  pathOrUrl: string,
  responseType: "json" | "arraybuffer" = "json",
): Promise<T> => {
  const token = await getDelegatedAccessToken(userId);
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  try {
    const response = await axios.get<T>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: responseType === "json" ? "application/json" : "*/*",
        Prefer: "redeemSharingLinkIfNecessary",
      },
      responseType,
      timeout: responseType === "arraybuffer" ? 60_000 : 30_000,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  } catch (error) {
    throw mapError(error);
  }
};

const toListedFile = (item: GraphDriveItem, shareUrl: string): OneDriveListedFile | null => {
  if (!item.id || !item.name || item.folder) return null;
  if (typeof item.size === "number" && item.size > MAX_FILE_BYTES) return null;
  return {
    id: encodeToken(shareUrl, item.id, item.parentReference?.driveId),
    name: sanitizeFileName(item.name),
    mimeType: item.file?.mimeType || "application/octet-stream",
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

const openShare = async (userId: number, rawUrl: string) => {
  const candidates = await shareCandidates(rawUrl);
  let lastError: AppError | null = null;
  for (const shareUrl of candidates) {
    try {
      const item = await graphGet<GraphDriveItem>(
        userId,
        `${sharePath(shareUrl)}/driveItem?$select=id,name,size,file,folder,parentReference`,
      );
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
    AppError(HTTP_STATUS.BAD_REQUEST, "That OneDrive link could not be opened.", {
      code: "ONEDRIVE_NOT_FOUND",
    })
  );
};

const listChildren = async (userId: number, shareUrl: string, itemId: string | null, driveId?: string) => {
  const items: GraphDriveItem[] = [];
  let next: string | null =
    driveId && itemId
      ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,size,file,folder,parentReference`
      : itemId
        ? `${sharePath(shareUrl)}/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,size,file,folder,parentReference`
        : `${sharePath(shareUrl)}/driveItem/children?$top=200&$select=id,name,size,file,folder,parentReference`;
  const seen = new Set<string>();

  while (next && !seen.has(next)) {
    seen.add(next);
    const page: GraphDriveItemPage = await graphGet<GraphDriveItemPage>(userId, next);
    items.push(...(page.value ?? []));
    const link: string | undefined = page["@odata.nextLink"];
    next = link || null;
  }
  return items;
};

const collectFiles = async (
  userId: number,
  shareUrl: string,
  itemId: string | null,
  driveId: string | undefined,
  depth: number,
  seen: Set<string>,
) => {
  const files: OneDriveListedFile[] = [];
  if (depth > MAX_DEPTH) return files;
  const key = itemId || "root";
  if (seen.has(key)) return files;
  seen.add(key);

  const children = await listChildren(userId, shareUrl, itemId, driveId);
  for (const child of children) {
    if (!child.id || !child.name) continue;
    if (child.folder) {
      files.push(
        ...(await collectFiles(
          userId,
          shareUrl,
          child.id,
          child.parentReference?.driveId || driveId,
          depth + 1,
          seen,
        )),
      );
      continue;
    }
    const listed = toListedFile(child, shareUrl);
    if (listed) files.push(listed);
  }
  return files;
};

/** Resolve a pasted OneDrive/SharePoint link using the connected Microsoft account. */
export const listShareLinkWithConnectedAccount = async (userId: number, rawUrl: string) => {
  const trimmed = rawUrl.trim();
  if (!isOneDriveUrl(trimmed)) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Paste a valid OneDrive or SharePoint file or folder link.", {
      code: "ONEDRIVE_URL_INVALID",
    });
  }

  const opened = await openShare(userId, trimmed);
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

  const files = await collectFiles(
    userId,
    shareUrl,
    driveId ? opened.item.id || null : null,
    driveId,
    0,
    new Set(),
  );
  if (!files.length) {
    throw AppError(HTTP_STATUS.NOT_FOUND, "No files found in that OneDrive folder.", {
      code: "ONEDRIVE_EMPTY",
    });
  }
  return { kind: "folder" as const, files };
};

export const downloadShareLinkWithConnectedAccount = async (userId: number, token: string) => {
  const { shareUrl, itemId, driveId } = decodeToken(token);
  const meta = driveId
    ? await graphGet<GraphDriveItem>(
        userId,
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,folder,parentReference`,
      )
    : await graphGet<GraphDriveItem>(
        userId,
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

  const direct = meta["@microsoft.graph.downloadUrl"];
  const path =
    direct ||
    (driveId
      ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`
      : `${sharePath(shareUrl)}/items/${encodeURIComponent(itemId)}/content`);
  const buffer = Buffer.from(await graphGet<ArrayBuffer>(userId, path, "arraybuffer"));
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
