import { ClientSecretCredential } from "@azure/identity";
import { env } from "../../config/env.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

let credential: ClientSecretCredential | null = null;

export const isMsGraphConfigured = () =>
  Boolean(env.msClientId.trim() && env.msClientSecret.trim() && env.msTenantId.trim());

export const requireMsGraphConfig = (): {
  clientId: string;
  clientSecret: string;
  tenantId: string;
} => {
  const clientId = env.msClientId.trim();
  const clientSecret = env.msClientSecret.trim();
  const tenantId = env.msTenantId.trim();
  if (!clientId || !clientSecret || !tenantId) {
    throw AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "OneDrive is not configured. Add MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_TENANT_ID to config/.env.",
      { code: "ONEDRIVE_NOT_CONFIGURED" },
    );
  }
  return { clientId, clientSecret, tenantId };
};

const getCredential = () => {
  const { clientId, clientSecret, tenantId } = requireMsGraphConfig();
  if (!credential) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return credential;
};

/**
 * App-only (client credentials) token via @azure/identity.
 * Required application permissions (admin consent): Files.Read.All, Sites.Read.All.
 */
export const getGraphToken = async () => {
  try {
    const token = await getCredential().getToken("https://graph.microsoft.com/.default");
    if (!token?.token) {
      throw AppError(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        "Microsoft authentication failed. Confirm the app registration and admin consent for Graph permissions.",
        { code: "ONEDRIVE_AUTH_FAILED" },
      );
    }
    return token.token;
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/AADSTS700016|AADSTS7000215|invalid_client|unauthorized_client/i.test(message)) {
      throw AppError(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        "Microsoft app credentials are invalid. Check MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_TENANT_ID.",
        { code: "ONEDRIVE_AUTH_INVALID" },
      );
    }
    throw AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "Microsoft authentication failed. Confirm the app registration and admin consent for Graph permissions.",
      { code: "ONEDRIVE_AUTH_FAILED" },
    );
  }
};

export const clearMsGraphCredential = () => {
  credential = null;
};
