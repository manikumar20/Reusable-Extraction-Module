import { apiUrl } from "@/services/client";
import type { DriveListedFile } from "@/types";

export const listDriveFiles = async (url: string) => {
  const response = await fetch(apiUrl("/extract/drive/list"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url }),
  });
  const payload = (await response.json().catch(() => null)) as {
    kind?: "folder" | "file";
    files?: DriveListedFile[];
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.files?.length) {
    throw new Error(payload?.error?.message || "Could not load that Drive link.");
  }
  return payload as { kind: "folder" | "file"; files: DriveListedFile[] };
};

export const downloadDriveFile = async (file: DriveListedFile) => {
  const params = new URLSearchParams();
  if (file.resourceKey) params.set("resourceKey", file.resourceKey);
  const query = params.toString();
  const response = await fetch(
    apiUrl(`/extract/drive/file/${encodeURIComponent(file.id)}${query ? `?${query}` : ""}`),
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message || `Could not download ${file.name}.`);
  }
  const blob = await response.blob();
  const headerName = response.headers.get("X-File-Name");
  const name = headerName ? decodeURIComponent(headerName) : file.name;
  return new File([blob], name, { type: blob.type || file.mimeType || "application/octet-stream" });
};
