import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { DocumentsPage } from "./DocumentsPage";
import { ExtractPage } from "./ExtractPage";
import { LoginPage } from "./LoginPage";
import { ProfilePage } from "./ProfilePage";
import { Sidebar } from "./Sidebar";
import { TemplateBuilderPage } from "./templates/TemplateBuilderPage";
import { TemplatesPage } from "./templates/TemplatesPage";

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
};

export const App = () => {
  const location = useLocation();
  const isAuthRoute = location.pathname === "/login";

  if (isAuthRoute) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <RequireAuth>
      <div className="shell">
        <Sidebar />
        <div className="workspace">
          <Routes>
            <Route path="/" element={<ExtractPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/templates/new" element={<TemplateBuilderPage />} />
            <Route path="/templates/:id/edit" element={<TemplateBuilderPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </RequireAuth>
  );
};
