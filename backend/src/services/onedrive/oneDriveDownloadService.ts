import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { graphGet } from "./graphClient.js";
import type { GraphDriveItem } from "./types.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const isTrustedDownloadHost = (hostname: string) => {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return (
    host === "graph.microsoft.com" ||
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

const assertSize = (bytes: Buffer) => {
  if (bytes.length > MAX_FILE_BYTES) {
    throw AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, "That OneDrive file is too large to import.", {
      code: "ONEDRIVE_FILE_TOO_LARGE",
    });
  }
};

export const downloadByDriveItem = async (driveId: string, itemId: string) => {
  const bytes = Buffer.from(
    await graphGet<ArrayBuffer>(
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
      { responseType: "arraybuffer", accept: "*/*" },
    ),
  );
  assertSize(bytes);
  return bytes;
};

export const downloadByShareItem = async (shareTokenPath: string, itemId: string) => {
  const meta = await graphGet<GraphDriveItem>(`${shareTokenPath}/items/${encodeURIComponent(itemId)}`);
  const direct = meta["@microsoft.graph.downloadUrl"];
  if (direct) {
    let host = "";
    try {
      host = new URL(direct).hostname;
    } catch {
      throw AppError(HTTP_STATUS.BAD_GATEWAY, "OneDrive returned an invalid download URL.", {
        code: "ONEDRIVE_DOWNLOAD_HOST",
      });
    }
    if (!isTrustedDownloadHost(host)) {
      throw AppError(HTTP_STATUS.BAD_GATEWAY, "OneDrive returned an unexpected download location.", {
        code: "ONEDRIVE_DOWNLOAD_HOST",
      });
    }
    const bytes = Buffer.from(
      await graphGet<ArrayBuffer>(direct, { responseType: "arraybuffer", accept: "*/*" }),
    );
    assertSize(bytes);
    return bytes;
  }

  const bytes = Buffer.from(
    await graphGet<ArrayBuffer>(`${shareTokenPath}/items/${encodeURIComponent(itemId)}/content`, {
      responseType: "arraybuffer",
      accept: "*/*",
    }),
  );
  assertSize(bytes);
  return bytes;
};

export { MAX_FILE_BYTES };
