import { getAccessToken } from "@/auth/session";
import { apiUrl } from "@/services/client";
import type { DriveListedFile } from "@/types";

type OneDriveStatus =
  | { connected: false }
  | { connected: true; accountEmail: string; accountName: string; expiresAt: string };

const authHeaders = (json = false): HeadersInit => {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const readError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
};

export const getOneDriveStatus = async () => {
  const response = await fetch(apiUrl("/onedrive/status"), { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as OneDriveStatus;
};

export const getOneDriveAuthUrl = async () => {
  const response = await fetch(apiUrl("/onedrive/auth-url"), { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { url?: string };
  if (!payload.url) throw new Error("OneDrive connect URL was missing.");
  return payload.url;
};

export const disconnectOneDrive = async () => {
  const response = await fetch(apiUrl("/onedrive/disconnect"), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response));
};

/** List files from a pasted OneDrive/SharePoint link using the connected Microsoft account. */
export const listOneDriveShareLink = async (url: string) => {
  const response = await fetch(apiUrl("/onedrive/share/list"), {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { files?: DriveListedFile[] };
  if (!payload.files?.length) throw new Error("No files found in that OneDrive link.");
  return payload.files;
};

export const downloadConnectedOneDriveFile = async (file: DriveListedFile) => {
  const response = await fetch(apiUrl(`/onedrive/files/${encodeURIComponent(file.id)}`), {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response));
  const blob = await response.blob();
  const headerName = response.headers.get("X-File-Name");
  const name = headerName ? decodeURIComponent(headerName) : file.name;
  return new File([blob], name, { type: blob.type || file.mimeType || "application/octet-stream" });
};
