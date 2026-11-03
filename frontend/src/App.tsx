import { Route, Routes } from "react-router-dom";
import { ExtractPage } from "./ExtractPage";
import { Sidebar } from "./Sidebar";
import { TemplateBuilderPage } from "./templates/TemplateBuilderPage";
import { TemplatesPage } from "./templates/TemplatesPage";

export const App = () => (
  <div className="shell">
    <Sidebar />
    <div className="workspace">
      <Routes>
        <Route path="/" element={<ExtractPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/new" element={<TemplateBuilderPage />} />
        <Route path="/templates/:id/edit" element={<TemplateBuilderPage />} />
      </Routes>
    </div>
  </div>
);
