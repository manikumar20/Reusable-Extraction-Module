export type UserProfile = {
  id?: number;
  name: string;
  email: string;
  organization: string;
  role: string;
};

export type AuthSession = {
  accessToken: string;
  user: UserProfile;
};

const SESSION_KEY = "extractiq-session";

const defaults: UserProfile = {
  name: "Alex Chen",
  email: "alex@extractiq.app",
  organization: "ExtractIQ",
  role: "Document reviewer",
};

export const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "EQ";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
};

const normalizeUser = (parsed: Partial<UserProfile>): UserProfile | null => {
  if (!parsed.email?.trim()) return null;
  const id = parsed.id == null ? undefined : Number(parsed.id);
  return {
    id: id != null && Number.isInteger(id) && id > 0 ? id : undefined,
    name: parsed.name?.trim() || defaults.name,
    email: parsed.email.trim(),
    organization: parsed.organization?.trim() || defaults.organization,
    role: parsed.role?.trim() || defaults.role,
  };
};

export const getSession = (): AuthSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession> & {
      token?: string;
      user?: Partial<UserProfile>;
    };
    const accessToken = parsed.accessToken || parsed.token;
    if (!accessToken || !parsed.user) return null;
    const user = normalizeUser(parsed.user);
    if (!user) return null;
    return { accessToken, user };
  } catch {
    return null;
  }
};

export const setSession = (session: AuthSession) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

export const getAccessToken = () => getSession()?.accessToken ?? null;

export const getSessionUser = (): UserProfile | null => getSession()?.user ?? null;

/** @deprecated Prefer getSessionUser */
export const readSession = () => getSessionUser();

/** @deprecated Prefer getAccessToken */
export const readAuthToken = () => getAccessToken();

/** @deprecated Prefer setSession */
export const writeSession = (accessToken: string, user: UserProfile) => {
  setSession({ accessToken, user });
};
