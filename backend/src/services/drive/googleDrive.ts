import { env } from "../../config/env.js";
import {
  ALLOWED_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
} from "../../middleware/documentUpload.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type DriveResourceKind = "folder" | "file";

export type DriveListedFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  exportMimeType?: string;
  resourceKey?: string;
};

type DriveApiFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  resourceKey?: string;
};

type ParsedDriveUrl = {
  kind: DriveResourceKind;
  id: string;
  resourceKey?: string;
};

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";
const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

const EXPORT_FOR: Record<string, { mimeType: string; extension: string }> = {
  [GOOGLE_DOC]: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
  },
  [GOOGLE_SHEET]: {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx",
  },
  [GOOGLE_SLIDE]: {
    mimeType: "application/pdf",
    extension: ".pdf",
  },
};

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

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const requireApiKey = () => {
  const key = env.googleDriveApiKey;
  if (!key) {
    throw AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "Google Drive is not configured. Add GOOGLE_DRIVE_API_KEY to config/.env.",
      { code: "DRIVE_NOT_CONFIGURED" },
    );
  }
  return key;
};

const resourceHeaders = (
  fileIdOrPairs: string | string[],
  resourceKey?: string,
): Record<string, string> => {
  if (Array.isArray(fileIdOrPairs)) {
    const pairs = fileIdOrPairs.filter(Boolean);
    if (!pairs.length) return {};
    return { "X-Goog-Drive-Resource-Keys": pairs.join(",") };
  }
  if (!resourceKey) return {};
  return { "X-Goog-Drive-Resource-Keys": `${fileIdOrPairs}/${resourceKey}` };
};

export const parseDriveUrl = (raw: string): ParsedDriveUrl | null => {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!host.endsWith("google.com") && !host.endsWith("googleusercontent.com")) {
    return null;
  }

  const resourceKey =
    url.searchParams.get("resourcekey") ||
    url.searchParams.get("resourceKey") ||
    undefined;

  const withKey = (parsed: Omit<ParsedDriveUrl, "resourceKey">): ParsedDriveUrl =>
    resourceKey ? { ...parsed, resourceKey } : parsed;

  const folderMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return withKey({ kind: "folder", id: folderMatch[1] });

  const fileMatch = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch?.[1]) return withKey({ kind: "file", id: fileMatch[1] });

  const docsMatch = url.pathname.match(
    /\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/,
  );
  if (docsMatch?.[2]) return withKey({ kind: "file", id: docsMatch[2] });

  const id = url.searchParams.get("id");
  if (id && /^[a-zA-Z0-9_-]+$/.test(id)) {
    if (url.pathname.includes("/folders/")) return withKey({ kind: "folder", id });
    return withKey({ kind: "file", id });
  }

  return null;
};

const mapDriveError = (status: number, payload: unknown) => {
  let message = "Google Drive request failed.";
  let code = "DRIVE_REQUEST_FAILED";
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as {
          error?: {
            message?: string;
            status?: string;
            errors?: { reason?: string; message?: string }[];
          };
        }).error
      : undefined;
  const reason = error?.errors?.[0]?.reason || "";
  const apiMessage = error?.message || error?.errors?.[0]?.message || "";

  if (reason === "notFound" || status === 404) {
    message =
      "Drive file or folder was not found. Use the full shared link (including resourcekey if present) and set sharing to Anyone with the link.";
    code = "DRIVE_NOT_FOUND";
  } else if (reason === "authError" || reason === "keyInvalid" || reason === "invalid") {
    message = "Google Drive API key is invalid. Create a new key in Google Cloud Console.";
    code = "DRIVE_KEY_INVALID";
  } else if (reason === "accessNotConfigured" || /has not been used|disabled/i.test(apiMessage)) {
    message =
      "Enable the Google Drive API for your Google Cloud project, then try again.";
    code = "DRIVE_API_DISABLED";
  } else if (reason === "ipRefererBlocked" || /referer|IP address/i.test(apiMessage)) {
    message =
      "This API key is restricted. Allow server requests (no HTTP referrer restriction), or create an unrestricted key for local use.";
    code = "DRIVE_KEY_RESTRICTED";
  } else if (status === 401 || status === 403) {
    message =
      apiMessage ||
      "Drive access denied. Share the folder/file as Anyone with the link, enable Drive API, and check API key restrictions.";
    code = "DRIVE_FORBIDDEN";
  } else if (apiMessage) {
    message = apiMessage;
  }

  return { message, code, status: status === 404 ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.BAD_GATEWAY };
};

const driveFetch = async (
  path: string,
  apiKey: string,
  init?: RequestInit & { resourceId?: string; resourceKey?: string; resourcePairs?: string[] },
) => {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${DRIVE_API}${path}${separator}key=${encodeURIComponent(apiKey)}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.resourcePairs
        ? resourceHeaders(init.resourcePairs)
        : resourceHeaders(init?.resourceId || "", init?.resourceKey)),
      ...(init?.headers ?? {}),
    },
  });
  if (response.ok) return response;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const mapped = mapDriveError(response.status, payload);
  throw AppError(mapped.status, mapped.message, { code: mapped.code });
};

const withExtension = (name: string, extension: string) => {
  const base = name.replace(/\.[^.]+$/, "").trim() || "drive-file";
  const current = extensionOf(name);
  if (current === extension) return name;
  return `${base}${extension}`;
};

const toListedFile = (file: DriveApiFile, fallbackResourceKey?: string): DriveListedFile | null => {
  if (!file.id || !file.name || !file.mimeType) return null;
  if (file.mimeType === GOOGLE_FOLDER) return null;

  const resourceKey = file.resourceKey || fallbackResourceKey;
  const exportSpec = EXPORT_FOR[file.mimeType];
  if (exportSpec) {
    return {
      id: file.id,
      name: withExtension(file.name, exportSpec.extension),
      mimeType: file.mimeType,
      size: file.size ? Number(file.size) : null,
      exportMimeType: exportSpec.mimeType,
      ...(resourceKey ? { resourceKey } : {}),
    };
  }

  const byMime = MIME_EXTENSION[file.mimeType];
  const byName = extensionOf(file.name);
  const extension = byMime || byName;
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) return null;

  return {
    id: file.id,
    name: withExtension(file.name, extension),
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : null,
    ...(resourceKey ? { resourceKey } : {}),
  };
};

const getMeta = async (fileId: string, apiKey: string, resourceKey?: string) => {
  const response = await driveFetch(
    `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,resourceKey&supportsAllDrives=true`,
    apiKey,
    { resourceId: fileId, resourceKey },
  );
  return (await response.json()) as DriveApiFile;
};

const listFolderPage = async (
  folderId: string,
  apiKey: string,
  resourceKeys: string[] = [],
  pageToken?: string,
) => {
  const params = new URLSearchParams({
    q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,size,resourceKey)",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    orderBy: "name_natural",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const response = await driveFetch(`/files?${params.toString()}`, apiKey, {
    resourcePairs: resourceKeys,
  });
  return (await response.json()) as { files?: DriveApiFile[]; nextPageToken?: string };
};

const describeUnsupported = (mimeType: string, name: string) => {
  if (mimeType === GOOGLE_FOLDER) return `folder "${name}"`;
  if (mimeType === "application/vnd.google-apps.form") return `Google Form "${name}"`;
  if (mimeType === "application/vnd.google-apps.script") return `Apps Script "${name}"`;
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    return `Google file "${name}"`;
  }
  return `"${name}" (${mimeType})`;
};

const collectFolderFiles = async (
  folderId: string,
  apiKey: string,
  resourceKeys: string[],
  depth: number,
  seen: Set<string>,
) => {
  const files: DriveListedFile[] = [];
  const skipped: string[] = [];
  if (seen.has(folderId) || depth > 4) return { files, skipped };
  seen.add(folderId);

  let pageToken: string | undefined;
  do {
    const page = await listFolderPage(folderId, apiKey, resourceKeys, pageToken);
    for (const row of page.files ?? []) {
      if (!row.id || !row.mimeType || !row.name) continue;
      if (row.mimeType === GOOGLE_FOLDER) {
        skipped.push(describeUnsupported(row.mimeType, row.name));
        const childKeys = [...resourceKeys];
        if (row.resourceKey) childKeys.push(`${row.id}/${row.resourceKey}`);
        const nested = await collectFolderFiles(row.id, apiKey, childKeys, depth + 1, seen);
        files.push(...nested.files);
        skipped.push(...nested.skipped);
        continue;
      }
      const listed = toListedFile(row);
      if (listed) files.push(listed);
      else skipped.push(describeUnsupported(row.mimeType, row.name));
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return { files, skipped };
};

export const listDriveFiles = async (url: string) => {
  const parsed = parseDriveUrl(url);
  if (!parsed) {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "Paste a valid Google Drive folder or file link.", {
      code: "DRIVE_URL_INVALID",
    });
  }

  const apiKey = requireApiKey();
  const rootKeys = parsed.resourceKey ? [`${parsed.id}/${parsed.resourceKey}`] : [];

  if (parsed.kind === "file") {
    const meta = await getMeta(parsed.id, apiKey, parsed.resourceKey);
    if (meta.mimeType === GOOGLE_FOLDER) {
      const folderUrl = parsed.resourceKey
        ? `https://drive.google.com/drive/folders/${parsed.id}?resourcekey=${parsed.resourceKey}`
        : `https://drive.google.com/drive/folders/${parsed.id}`;
      return listDriveFiles(folderUrl);
    }
    const listed = toListedFile(meta, parsed.resourceKey);
    if (!listed) {
      throw AppError(
        HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
        "That Drive file type is not supported for extraction.",
        { code: "DRIVE_UNSUPPORTED" },
      );
    }
    return { kind: "file" as const, id: parsed.id, files: [listed] };
  }

  const { files, skipped } = await collectFolderFiles(parsed.id, apiKey, rootKeys, 0, new Set());

  if (!files.length) {
    const sample = [...new Set(skipped)].slice(0, 4).join("; ");
    throw AppError(
      HTTP_STATUS.NOT_FOUND,
      sample
        ? `No PDF/Word/Excel/image files found. Visible items: ${sample}. Put extractable documents in the shared folder (Google Forms/Scripts are skipped).`
        : "No supported PDF/Word/Excel/image files found in that Drive folder.",
      { code: "DRIVE_EMPTY" },
    );
  }

  return { kind: "folder" as const, id: parsed.id, files };
};

export const downloadDriveFile = async (fileId: string, resourceKey?: string) => {
  const apiKey = requireApiKey();
  const meta = await getMeta(fileId, apiKey, resourceKey);
  const listed = toListedFile(meta, resourceKey || meta.resourceKey);
  if (!listed) {
    throw AppError(
      HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
      "That Drive file type is not supported for extraction.",
      { code: "DRIVE_UNSUPPORTED" },
    );
  }

  const effectiveKey = resourceKey || listed.resourceKey || meta.resourceKey;
  const exportSpec = listed.exportMimeType ? EXPORT_FOR[meta.mimeType || ""] : null;

  const response = exportSpec
    ? await driveFetch(
        `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportSpec.mimeType)}`,
        apiKey,
        { resourceId: fileId, resourceKey: effectiveKey },
      )
    : await driveFetch(
        `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        apiKey,
        { resourceId: fileId, resourceKey: effectiveKey },
      );

  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = extensionOf(listed.name);
  const isImage = IMAGE_EXTENSIONS.includes(extension);
  const limit = isImage ? MAX_IMAGE_BYTES : MAX_UPLOAD_BYTES;
  if (buffer.length > limit) {
    throw AppError(
      HTTP_STATUS.PAYLOAD_TOO_LARGE,
      isImage
        ? `Images must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller.`
        : `File is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      { code: "DRIVE_FILE_TOO_LARGE" },
    );
  }

  return {
    fileName: listed.name,
    mimeType: exportSpec?.mimeType || listed.mimeType || "application/octet-stream",
    buffer,
  };
};
