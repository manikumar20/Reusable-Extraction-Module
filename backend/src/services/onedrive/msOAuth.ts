import axios from "axios";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import {
  deleteOneDriveConnection,
  getOneDriveConnection,
  upsertOneDriveConnection,
} from "../../db/onedrive/onedriveConnectionDb.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";
import { requireMsGraphConfig } from "./msGraphAuth.js";

const SCOPES = ["openid", "profile", "offline_access", "Files.Read", "Files.Read.All", "User.Read"].join(
  " ",
);

type OAuthState = {
  uid: number;
  nonce: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

const tenantAuthBase = () => {
  const { tenantId } = requireMsGraphConfig();
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
};

export const buildOneDriveAuthUrl = (userId: number) => {
  requireMsGraphConfig();
  const state = jwt.sign(
    { uid: userId, nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}` } satisfies OAuthState,
    env.jwtSecret,
    { expiresIn: "15m" },
  );
  const params = new URLSearchParams({
    client_id: env.msClientId,
    response_type: "code",
    redirect_uri: env.msRedirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `${tenantAuthBase()}/authorize?${params.toString()}`;
};

const parseState = (state: string): number => {
  try {
    const payload = jwt.verify(state, env.jwtSecret) as OAuthState;
    if (!Number.isInteger(payload.uid) || payload.uid < 1) {
      throw new Error("bad uid");
    }
    return payload.uid;
  } catch {
    throw AppError(HTTP_STATUS.BAD_REQUEST, "OneDrive sign-in expired. Start Connect OneDrive again.", {
      code: "ONEDRIVE_OAUTH_STATE_INVALID",
    });
  }
};

const exchangeToken = async (body: URLSearchParams) => {
  requireMsGraphConfig();
  body.set("client_id", env.msClientId);
  body.set("client_secret", env.msClientSecret);
  let response;
  try {
    response = await axios.post<TokenResponse>(`${tenantAuthBase()}/token`, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      timeout: 20_000,
      validateStatus: () => true,
    });
  } catch {
    throw AppError(HTTP_STATUS.BAD_GATEWAY, "Microsoft authentication did not respond. Try again.", {
      code: "ONEDRIVE_AUTH_UNREACHABLE",
    });
  }
  if (response.status >= 400 || !response.data.access_token) {
    const description = response.data.error_description || response.data.error || "";
    if (/AADSTS7000215|invalid_client/i.test(description)) {
      throw AppError(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        "Microsoft app credentials are invalid. Use the client secret Value (not Secret ID) in MS_CLIENT_SECRET.",
        { code: "ONEDRIVE_AUTH_INVALID" },
      );
    }
    throw AppError(
      HTTP_STATUS.BAD_GATEWAY,
      "Microsoft sign-in failed. Confirm redirect URI and Graph delegated permissions.",
      { code: "ONEDRIVE_OAUTH_FAILED" },
    );
  }
  return response.data;
};

const fetchProfile = async (accessToken: string) => {
  try {
    const response = await axios.get<{ mail?: string; userPrincipalName?: string; displayName?: string }>(
      "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        timeout: 15_000,
      },
    );
    return {
      email: response.data.mail || response.data.userPrincipalName || "",
      name: response.data.displayName || "",
    };
  } catch {
    return { email: "", name: "" };
  }
};

export const completeOneDriveOAuth = async (code: string, state: string) => {
  const userId = parseState(state);
  const token = await exchangeToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.msRedirectUri,
      scope: SCOPES,
    }),
  );
  const profile = await fetchProfile(token.access_token!);
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000);
  await upsertOneDriveConnection({
    userId,
    accountEmail: profile.email,
    accountName: profile.name,
    accessToken: token.access_token!,
    refreshToken: token.refresh_token || "",
    expiresAt,
    scope: token.scope || SCOPES,
  });
  return { userId, email: profile.email, name: profile.name };
};

export const getOneDriveStatus = async (userId: number) => {
  const row = await getOneDriveConnection(userId);
  if (!row) return { connected: false as const };
  return {
    connected: true as const,
    accountEmail: row.account_email,
    accountName: row.account_name,
    expiresAt: row.expires_at.toISOString(),
  };
};

export const disconnectOneDrive = async (userId: number) => {
  await deleteOneDriveConnection(userId);
};

/** Returns a valid delegated access token for the signed-in ExtractIQ user. */
export const getDelegatedAccessToken = async (userId: number) => {
  const row = await getOneDriveConnection(userId);
  if (!row) {
    throw AppError(
      HTTP_STATUS.UNAUTHORIZED,
      "OneDrive is not connected. Click Connect OneDrive and sign in with Microsoft.",
      { code: "ONEDRIVE_NOT_CONNECTED" },
    );
  }

  if (row.expires_at.getTime() > Date.now() + 60_000) {
    return row.access_token;
  }

  if (!row.refresh_token) {
    await deleteOneDriveConnection(userId);
    throw AppError(
      HTTP_STATUS.UNAUTHORIZED,
      "OneDrive session expired. Connect OneDrive again.",
      { code: "ONEDRIVE_REAUTH_REQUIRED" },
    );
  }

  const token = await exchangeToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
      scope: SCOPES,
    }),
  );
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000);
  await upsertOneDriveConnection({
    userId,
    accountEmail: row.account_email,
    accountName: row.account_name,
    accessToken: token.access_token!,
    refreshToken: token.refresh_token || row.refresh_token,
    expiresAt,
    scope: token.scope || row.scope,
  });
  return token.access_token!;
};

export const frontendRedirectAfterOAuth = (ok: boolean, message?: string) => {
  const base = env.msFrontendRedirect.replace(/\/$/, "") || "http://127.0.0.1:5173";
  const url = new URL(base.includes("://") ? base : `http://${base}`);
  url.searchParams.set("onedrive", ok ? "connected" : "error");
  if (message) url.searchParams.set("onedriveMessage", message.slice(0, 180));
  return url.toString();
};
