import { NavLink } from "react-router-dom";

const itemClass = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-item active" : "nav-item");

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
        Extract
      </NavLink>
      <NavLink to="/templates" className={itemClass}>
        Templates
      </NavLink>
    </nav>
  </header>
);
