import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/layout/AppSidebar";

export const AppLayout = () => (
  <div className="shell">
    <AppSidebar />
    <div className="workspace">
      <Outlet />
    </div>
  </div>
);
