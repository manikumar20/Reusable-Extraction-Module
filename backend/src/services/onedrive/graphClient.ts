import axios, { type AxiosError } from "axios";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { clearMsGraphCredential, getGraphToken } from "./msGraphAuth.js";

export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

const readAxiosMessage = (error: AxiosError) => {
  const data = error.response?.data as { error?: { message?: string; code?: string } } | undefined;
  return data?.error?.message || data?.error?.code || error.message || "OneDrive request failed.";
};

export const mapGraphAxiosError = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return AppError(HTTP_STATUS.BAD_GATEWAY, "OneDrive request failed.", {
      code: "ONEDRIVE_REQUEST_FAILED",
    });
  }

  const status = error.response?.status || 0;
  const text = readAxiosMessage(error);

  if (status === 401) {
    clearMsGraphCredential();
    return AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "Microsoft Graph authentication expired or was rejected. Confirm MS_* credentials and app permissions.",
      { code: "ONEDRIVE_AUTH_REJECTED" },
    );
  }
  if (status === 403 || /accessdenied|access denied|forbidden|do not have permission/i.test(text)) {
    return AppError(
      HTTP_STATUS.FORBIDDEN,
      "That OneDrive/SharePoint link is inaccessible to this app. Share it in your organization, grant Files.Read.All (application) with admin consent, or use Browse files. Personal Anyone-with-the-link shares often require delegated user sign-in.",
      { code: "ONEDRIVE_FORBIDDEN" },
    );
  }
  if (status === 404 || /itemnotfound|not found|sharing link no longer exists|invalid share/i.test(text)) {
    return AppError(
      HTTP_STATUS.BAD_REQUEST,
      "That OneDrive/SharePoint link could not be opened. Confirm the sharing link is valid and not expired.",
      { code: "ONEDRIVE_NOT_FOUND" },
    );
  }
  if (status === 429) {
    return AppError(
      HTTP_STATUS.TOO_MANY_REQUESTS,
      "OneDrive rate limit reached. Wait a moment and try again.",
      { code: "ONEDRIVE_RATE_LIMITED" },
    );
  }
  if (status >= 500 || !status) {
    return AppError(HTTP_STATUS.BAD_GATEWAY, "OneDrive is temporarily unavailable. Try again.", {
      code: "ONEDRIVE_UPSTREAM",
    });
  }
  return AppError(HTTP_STATUS.BAD_REQUEST, text || "OneDrive request failed.", {
    code: "ONEDRIVE_REQUEST_FAILED",
  });
};

export const graphGet = async <T>(
  pathOrUrl: string,
  options?: { responseType?: "json" | "arraybuffer"; accept?: string; retried?: boolean },
): Promise<T> => {
  const token = await getGraphToken();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_BASE_URL}${pathOrUrl}`;
  try {
    const response = await axios.get<T>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: options?.accept || "application/json",
        Prefer: "redeemSharingLinkIfNecessary",
      },
      responseType: options?.responseType || "json",
      timeout: options?.responseType === "arraybuffer" ? 60_000 : 30_000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401 && !options?.retried) {
      clearMsGraphCredential();
      return graphGet<T>(pathOrUrl, { ...options, retried: true });
    }
    if (axios.isAxiosError(error) && error.response?.status === 429 && !options?.retried) {
      const retryAfter = Number(error.response.headers["retry-after"] || "2");
      const waitMs = Number.isFinite(retryAfter) ? Math.min(10_000, Math.max(500, retryAfter * 1000)) : 2000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return graphGet<T>(pathOrUrl, { ...options, retried: true });
    }
    throw mapGraphAxiosError(error);
  }
};
