import { createContext } from "react";
import type { UserProfile } from "@/auth/session";

export type AuthContextValue = {
  user: UserProfile | null;
  ready: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  updateProfile: (profile: UserProfile) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
