export type Page = "upload" | "template";

type SidebarProps = {
  page: Page;
  onPage: (page: Page) => void;
};

export const Sidebar = ({ page, onPage }: SidebarProps) => (
  <nav className="sidebar" aria-label="Pages">
    <div className="brand">
      <span className="mark" aria-hidden="true">
        Ex
      </span>
      <div>
        <strong>Extract</strong>
        <span>Customer documents</span>
      </div>
    </div>
    <div className="nav">
      <button
        type="button"
        className={page === "upload" ? "nav-item active" : "nav-item"}
        aria-current={page === "upload" ? "page" : undefined}
        onClick={() => onPage("upload")}
      >
        Upload
      </button>
      <button
        type="button"
        className={page === "template" ? "nav-item active" : "nav-item"}
        aria-current={page === "template" ? "page" : undefined}
        onClick={() => onPage("template")}
      >
        Template
        </button>
      </div>
  </nav>
);
