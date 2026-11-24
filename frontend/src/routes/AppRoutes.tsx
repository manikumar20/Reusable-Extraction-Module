import { Navigate, Route, Routes } from "react-router-dom";
import { PATHS } from "@/constants/paths";
import { AppLayout } from "@/layouts/AppLayout";
import { AuthLayout } from "@/layouts/AuthLayout";
import { LoginPage } from "@/pages/auth/LoginPage";
import { DocumentsPage } from "@/pages/documents/DocumentsPage";
import { ExtractPage } from "@/pages/extract/ExtractPage";
import { ProfilePage } from "@/pages/profile/ProfilePage";
import { TemplateBuilderPage } from "@/pages/templates/TemplateBuilderPage";
import { TemplatesPage } from "@/pages/templates/TemplatesPage";
import { AuthGuard } from "@/routes/AuthGuard";
import { PublicOnly } from "@/routes/PublicOnly";

const AppRoutes = () => (
  <Routes>
    <Route element={<PublicOnly />}>
      <Route element={<AuthLayout />}>
        <Route path={PATHS.LOGIN} element={<LoginPage />} />
      </Route>
    </Route>

    <Route element={<AuthGuard />}>
      <Route element={<AppLayout />}>
        <Route path={PATHS.HOME} element={<ExtractPage />} />
        <Route path={PATHS.DOCUMENTS} element={<DocumentsPage />} />
        <Route path={PATHS.TEMPLATES} element={<TemplatesPage />} />
        <Route path={PATHS.TEMPLATE_NEW} element={<TemplateBuilderPage />} />
        <Route path={PATHS.TEMPLATE_EDIT} element={<TemplateBuilderPage />} />
        <Route path={PATHS.PROFILE} element={<ProfilePage />} />
      </Route>
    </Route>

    <Route path="*" element={<Navigate to={PATHS.HOME} replace />} />
  </Routes>
);

export default AppRoutes;
