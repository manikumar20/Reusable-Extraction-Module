import { apiUrl } from "../services/api";
import { getAccessToken, type AuthSession, type UserProfile } from "./session";

type MeResponse = {
  user: UserProfile;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const authHeaders = (token?: string | null): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const value = token ?? getAccessToken();
  if (value) headers.Authorization = `Bearer ${value}`;
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

export const loginRequest = async (email: string, password: string): Promise<AuthSession> => {
  const response = await fetch(apiUrl("/auth/login"), {
    method: "POST",
    headers: authHeaders(null),
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  return (await response.json()) as AuthSession;
};

export const fetchMe = async (options?: { token?: string | null }): Promise<UserProfile> => {
  const response = await fetch(apiUrl("/auth/me"), {
    headers: authHeaders(options?.token),
  });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  const body = (await response.json()) as MeResponse;
  return body.user;
};

export const updateProfileRequest = async (profile: UserProfile): Promise<UserProfile> => {
  const response = await fetch(apiUrl("/auth/profile"), {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      name: profile.name,
      email: profile.email,
      organization: profile.organization,
      role: profile.role,
    }),
  });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  const body = (await response.json()) as MeResponse;
  return body.user;
};

export const logoutRequest = async () => {
  const token = getAccessToken();
  if (!token) return;
  await fetch(apiUrl("/auth/logout"), {
    method: "POST",
    headers: authHeaders(token),
  }).catch(() => undefined);
};
