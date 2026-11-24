import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthContext } from "@/auth/authContext";
import {
  clearSession,
  getAccessToken,
  getSession,
  getSessionUser,
  setSession,
  type UserProfile,
} from "@/auth/session";
import {
  fetchMe,
  loginRequest,
  logoutRequest,
  updateProfileRequest,
} from "@/services/authService";

type AuthProviderProps = {
  children: ReactNode;
};

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<UserProfile | null>(() => getSessionUser());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const session = getSession();
      if (!session) {
        if (!cancelled) {
          setUser(null);
          setReady(true);
        }
        return;
      }
      try {
        const me = await fetchMe({ token: session.accessToken });
        if (!cancelled) {
          setSession({ accessToken: session.accessToken, user: me });
          setUser(me);
        }
      } catch {
        clearSession();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginRequest(email, password);
    setSession(session);
    setUser(session.user);
  }, []);

  const updateProfile = useCallback(async (profile: UserProfile) => {
    const token = getAccessToken();
    const next = await updateProfileRequest(profile);
    if (token) setSession({ accessToken: token, user: next });
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Clear locally even if the API call fails.
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      isAuthenticated: Boolean(user),
      login,
      updateProfile,
      logout,
    }),
    [user, ready, login, updateProfile, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
