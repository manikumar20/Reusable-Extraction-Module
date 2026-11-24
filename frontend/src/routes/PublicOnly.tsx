import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { PATHS } from "@/constants/paths";

export const PublicOnly = () => {
  const { user, ready } = useAuth();

  if (!ready) return null;
  if (user) return <Navigate to={PATHS.HOME} replace />;

  return <Outlet />;
};
