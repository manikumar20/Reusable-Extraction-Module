import { NavLink } from "react-router-dom";

const itemClass = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-item active" : "nav-item");

export const Sidebar = () => (
  <header className="topbar">
    <NavLink to="/" className="mark" aria-label="Home">
      DX
    </NavLink>
    <nav className="nav" aria-label="Pages">
      <NavLink to="/" end className={itemClass}>
        Data Extraction
      </NavLink>
      <NavLink to="/templates" className={itemClass}>
        Templates
      </NavLink>
    </nav>
  </header>
);
