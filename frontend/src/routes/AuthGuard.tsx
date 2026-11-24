import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { PATHS } from "@/constants/paths";

export const AuthGuard = () => {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null;

  if (!user) {
    return <Navigate to={PATHS.LOGIN} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
};
