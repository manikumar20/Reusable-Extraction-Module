import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { graphGet } from "./graphClient.js";
import type { GraphDriveItem, GraphDriveItemPage } from "./types.js";

const isTrustedGraphHost = (hostname: string) => {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return host === "graph.microsoft.com";
};

const collectPagedChildren = async (firstUrl: string) => {
  const items: GraphDriveItem[] = [];
  let next: string | null = firstUrl;
  const seen = new Set<string>();

  while (next && !seen.has(next)) {
    seen.add(next);
    const page: GraphDriveItemPage = await graphGet<GraphDriveItemPage>(next);
    items.push(...(page.value ?? []));
    const link: string | undefined = page["@odata.nextLink"];
    if (!link) {
      next = null;
      break;
    }
    try {
      const url = new URL(link);
      if (!isTrustedGraphHost(url.hostname)) {
        throw AppError(HTTP_STATUS.BAD_GATEWAY, "OneDrive returned an unexpected pagination host.", {
          code: "ONEDRIVE_PAGINATION_HOST",
        });
      }
      next = link;
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error) throw error;
      next = null;
    }
  }

  return items;
};

export const getFolderChildren = async (driveId: string, folderId: string) =>
  collectPagedChildren(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}/children?$top=200&$select=id,name,size,file,folder,parentReference`,
  );

export const getShareChildren = async (shareTokenPath: string, itemId: string | null) =>
  collectPagedChildren(
    itemId
      ? `${shareTokenPath}/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,size,file,folder,parentReference`
      : `${shareTokenPath}/driveItem/children?$top=200&$select=id,name,size,file,folder,parentReference`,
  );
