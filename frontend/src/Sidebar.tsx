import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

const itemClass = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-item active" : "nav-item");

const THEME_KEY = "extractiq-theme";

const ThemeToggle = () => {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={next === "light" ? "Switch to light theme" : "Switch to dark theme"}
      title={next === "light" ? "Light theme" : "Dark theme"}
      onClick={() => setTheme(next)}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
        </svg>
      )}
    </button>
  );
};

export const Sidebar = () => (
  <header className="topbar">
    <NavLink to="/" className="brand-lockup" aria-label="ExtractIQ home">
      <span className="mark" aria-hidden="true">
        EQ
      </span>
      <span className="brand-name">ExtractIQ</span>
    </NavLink>
    <nav className="nav" aria-label="Pages">
      <NavLink to="/" end className={itemClass}>
        Extract &amp; Ingest
      </NavLink>
      <NavLink to="/templates" className={itemClass}>
        Templates
      </NavLink>
      <NavLink to="/documents" className={itemClass}>
        Documents
      </NavLink>
      <span className="nav-item nav-item-muted" title="Coming soon">
        Settings
      </span>
    </nav>
    <div className="topbar-user" title="Alex Carter">
      <ThemeToggle />
      <span className="topbar-avatar" aria-hidden="true">
        AC
      </span>
    </div>
  </header>
);
