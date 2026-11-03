import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { activateTemplate, deleteTemplate, listTemplates } from "./api";
import "./templates.css";
import {
  clearRememberedTemplate,
  rememberTemplate,
  TEMPLATE_CATEGORIES,
  type TemplateSummary,
} from "./types";

const categories = ["All", ...TEMPLATE_CATEGORIES];

export const TemplatesPage = () => {
  const navigate = useNavigate();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const filtering = category !== "All" || query.trim().length > 0;

  const refresh = () =>
    listTemplates({ category, query }).then((rows) => {
      setTemplates(rows);
      setError("");
    });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      refresh()
        .catch((reason: unknown) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : "Templates could not be loaded.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query]);

  const onDelete = async (template: TemplateSummary) => {
    if (!window.confirm(`Delete template “${template.name}”? This cannot be undone.`)) return;
    setDeletingId(template.id);
    setError("");
    try {
      await deleteTemplate(template.id);
      if (template.active) clearRememberedTemplate();
      setTemplates((current) => current.filter((row) => row.id !== template.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Template could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  };

  const onActivate = async (template: TemplateSummary) => {
    setActivatingId(template.id);
    setError("");
    try {
      const active = await activateTemplate(template.id);
      rememberTemplate(active);
      setTemplates((current) =>
        current.map((row) => ({ ...row, active: row.id === active.id })),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Template could not be set as active.");
    } finally {
      setActivatingId(null);
    }
  };

  const emptyLibrary = !loading && !filtering && templates.length === 0;

  return (
    <section className="tm">
      <header className="tm-header">
        <div>
          <h1>Templates</h1>
          <p className="tm-lead">
            Define the fields once, set one template as active, then extract with those fields.
          </p>
        </div>
        <div className="tm-header-actions">
          <input
            className="tm-search"
            type="search"
            value={query}
            placeholder="Search templates"
            aria-label="Search templates"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="tm-btn tm-btn-primary" onClick={() => navigate("/templates/new")}>
            New template
          </button>
        </div>
      </header>

      <div className="tm-chips" role="tablist" aria-label="Template categories">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            className={item === category ? "tm-chip active" : "tm-chip"}
            aria-pressed={item === category}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {error && <p className="tm-error">{error}</p>}
      {loading && <p className="tm-note">Loading templates…</p>}

      {!loading && filtering && templates.length === 0 ? (
        <div className="tm-empty">
          <p className="tm-note">No templates match your search.</p>
          <SampleUploadCard />
        </div>
      ) : emptyLibrary ? (
        <div className="tm-empty">
          <p className="tm-note">No templates yet. Upload one example, or start from a blank field list.</p>
          <SampleUploadCard />
        </div>
      ) : (
        !loading && (
          <div className="tm-grid">
            {templates.map((template) => (
              <article className={template.active ? "tm-card tm-card-active" : "tm-card"} key={template.id}>
                <div className="tm-card-top">
                  <h3>{template.name}</h3>
                  <div className="tm-card-top-meta">
                    {template.active && <span className="tm-active-badge">Active</span>}
                    <span className="tm-version">v{template.version}</span>
                    <button
                      type="button"
                      className="tm-card-x"
                      aria-label={`Delete ${template.name}`}
                      disabled={deletingId === template.id}
                      onClick={() => void onDelete(template)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="tm-card-fields">
                  {template.fields.slice(0, 4).map((field) => (
                    <span className="tm-chip" key={field.id}>
                      {field.name}
                    </span>
                  ))}
                  {template.fields.length > 4 && (
                    <span className="tm-chip">+{template.fields.length - 4}</span>
                  )}
                </div>
                <p className="tm-stats">{statsLine(template)}</p>
                <div className="tm-card-actions">
                  <button
                    type="button"
                    className={template.active ? "tm-btn tm-btn-active" : "tm-btn tm-btn-primary"}
                    disabled={template.active || activatingId === template.id}
                    onClick={() => void onActivate(template)}
                  >
                    {template.active
                      ? "Active for extraction"
                      : activatingId === template.id
                        ? "Setting…"
                        : "Set as active"}
                  </button>
                  <button type="button" className="tm-btn" onClick={() => navigate(`/templates/${template.id}/edit`)}>
                    Edit
                  </button>
                </div>
              </article>
            ))}
            <SampleUploadCard />
          </div>
        )
      )}
    </section>
  );
};

const statsLine = (template: TemplateSummary) => {
  const documents = `${template.documentCount.toLocaleString("en-US")} document${template.documentCount === 1 ? "" : "s"}`;
  if (template.autoApprovedPercent == null) return documents;
  return `${documents} · ${template.autoApprovedPercent}% auto-approved`;
};

const SampleUploadCard = () => {
  const navigate = useNavigate();
  return (
    <article className="tm-sample-card">
      <h3>Create from documents</h3>
      <p>Upload one document or several. Matching fields are filled in from the catalog.</p>
      <label className="tm-btn tm-btn-primary">
        Upload documents
        <input
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (!files.length) return;
            navigate("/templates/new", { state: { files } });
          }}
        />
      </label>
    </article>
  );
};
