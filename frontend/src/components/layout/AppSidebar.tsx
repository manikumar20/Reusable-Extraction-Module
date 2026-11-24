import { useEffect, useState } from "react";
import { FileInput, FileText, List, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { initialsOf } from "@/auth/session";

const itemClass = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-item active" : "nav-item");

const THEME_KEY = "extractiq-theme";
const SIDEBAR_KEY = "extractiq-sidebar";

const ThemeToggle = () => {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const next = theme === "dark" ? "light" : "dark";
  const label = theme === "dark" ? "Light mode" : "Dark mode";

  return (
    <button
      type="button"
      className="sidebar-row"
      data-tip={label}
      aria-label={next === "light" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(next)}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v1.5M12 19.5V21M4.9 4.9l1.1 1.1M18 18l1.1 1.1M3 12h1.5M19.5 12H21M4.9 19.1 6 18M18 6l1.1-1.1" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
};

export const AppSidebar = () => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches) {
      return true;
    }
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const sync = () => {
      if (media.matches) setCollapsed(true);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 820px)").matches) return;
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  const displayName = user?.name || "Account";
  const displayHint = user?.email || "View profile";

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"} aria-label="Main">
      <div className="sidebar-head">
        <NavLink to="/" className="sidebar-brand" data-tip="ExtractIQ" aria-label="ExtractIQ home">
          <span className="mark" aria-hidden="true">
            EQ
          </span>
          <span className="sidebar-brand-name">ExtractIQ</span>
        </NavLink>
        <button
          type="button"
          className="sidebar-toggle"
          data-tip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((open) => !open)}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>

      <p className="sidebar-kicker">Workspace</p>
      <nav className="sidebar-nav" aria-label="Pages">
        <NavLink to="/" end className={itemClass} data-tip="Extract and ingest">
          <FileInput aria-hidden="true" />
          <span>Extract and ingest</span>
        </NavLink>
        <NavLink to="/templates" className={itemClass} data-tip="Templates">
          <List aria-hidden="true" />
          <span>Templates</span>
        </NavLink>
        <NavLink to="/documents" className={itemClass} data-tip="Documents">
          <FileText aria-hidden="true" />
          <span>Documents</span>
        </NavLink>
      </nav>

      <div className="sidebar-foot">
        <span className="sidebar-row muted" data-tip="Settings">
          <Settings aria-hidden="true" />
          <span>Settings</span>
        </span>
        <ThemeToggle />
        <NavLink to="/profile" className="sidebar-account" data-tip="Profile" aria-label="Open profile">
          <span className="sidebar-avatar" aria-hidden="true">
            {initialsOf(displayName)}
          </span>
          <span className="sidebar-account-copy">
            <strong>{displayName}</strong>
            <span>{displayHint}</span>
          </span>
        </NavLink>
      </div>
    </aside>
  );
};
