import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FALLBACK_ACCEPT } from "../format";
import {
  activateTemplate,
  clearActiveTemplate,
  deleteTemplate,
  listTemplates,
} from "./api";
import "./templates.css";
import {
  clearRememberedTemplate,
  rememberTemplate,
  type TemplateSummary,
} from "./types";

const categorySubtitle = (category: string) => {
  if (category === "Finance") return "Finance & Accounts Payable";
  if (category === "HR") return "HR & People Ops";
  if (category === "Legal") return "Legal & Contracts";
  if (category === "Identity") return "Healthcare & Labs";
  return category;
};

const isDefaultTemplate = (name: string) =>
  name === "Default Line Fields" || name === "Default template";

const updatedOn = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const fieldMix = (template: TemplateSummary) => {
  const line = template.fields.filter((field) => field.level === "line").length;
  const header = template.fields.length - line;
  return { header, line };
};

export const TemplatesPage = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("Untitled template");
  const [createFiles, setCreateFiles] = useState<File[]>([]);

  useEffect(() => {
    document.title = "Templates · ExtractIQ";
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTemplates({ category: "All", query: "" })
      .then((rows) => {
        if (cancelled) return;
        setTemplates(rows);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Templates could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = useMemo(
    () => templates.find((template) => template.active) ?? null,
    [templates],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((template) => {
      if (active && template.id === active.id) return false;
      if (!needle) return true;
      return (
        template.name.toLowerCase().includes(needle) ||
        template.category.toLowerCase().includes(needle)
      );
    });
  }, [templates, active, query]);

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
      const next = await activateTemplate(template.id);
      rememberTemplate(next);
      setTemplates((current) => current.map((row) => ({ ...row, active: row.id === next.id })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Template could not be set as active.");
    } finally {
      setActivatingId(null);
    }
  };

  const onDeactivate = async () => {
    setDeactivating(true);
    setError("");
    try {
      await clearActiveTemplate();
      clearRememberedTemplate();
      setTemplates((current) => current.map((row) => ({ ...row, active: false })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Active template could not be cleared.");
    } finally {
      setDeactivating(false);
    }
  };

  const emptyLibrary = !loading && templates.length === 0;

  return (
    <section className="tm hub">
      {error && <p className="tm-error">{error}</p>}
      {loading && <p className="tm-note">Loading templates…</p>}

      {!loading && active && (
        <article className="hub-hero compact">
          <div className="hub-hero-main">
            <div className="hub-hero-title-row">
              <span className="hub-hero-dot" aria-hidden="true" />
              <h2>
                {active.name} <span className="hub-hero-ver">v{active.version}</span>
              </h2>
              {isDefaultTemplate(active.name) && <span className="hub-default-tag">Built-in</span>}
              <span className="hub-hero-sub-inline">{categorySubtitle(active.category)}</span>
            </div>
            <div className="hub-hero-meta">
              <span>{active.fields.length} fields</span>
              {fieldMix(active).header > 0 && <span>{fieldMix(active).header} header</span>}
              {fieldMix(active).line > 0 && <span>{fieldMix(active).line} line</span>}
              {active.documentCount > 0 && (
                <span>
                  {active.documentCount} document{active.documentCount === 1 ? "" : "s"}
                </span>
              )}
              {updatedOn(active.updatedAt) && <span>Updated {updatedOn(active.updatedAt)}</span>}
            </div>
            {active.fields.length > 0 && (
              <div className="hub-chip-row">
                {active.fields.slice(0, 6).map((field) => (
                  <span key={field.id}>{field.name}</span>
                ))}
                {active.fields.length > 6 && <span>+{active.fields.length - 6}</span>}
              </div>
            )}
          </div>

          <div className="hub-hero-actions">
            <button
              type="button"
              className="hub-btn-primary"
              onClick={() => navigate(`/templates/${active.id}/edit`)}
            >
              Edit
            </button>
            <button type="button" className="hub-btn-ghost" onClick={() => navigate("/")}>
              Test
            </button>
            <button
              type="button"
              className="hub-btn-ghost danger"
              disabled={deactivating}
              onClick={() => void onDeactivate()}
            >
              {deactivating ? "…" : "Deactivate"}
            </button>
          </div>
        </article>
      )}

      {!loading && !active && !emptyLibrary && (
        <div className="hub-empty-active">
          <strong>No active template</strong>
          <p>Choose Set as Active on a card below to pin it here.</p>
        </div>
      )}

      {!loading && (
        <div className="hub-library-tools">
          <label className="hub-search-wrap">
            <span className="hub-search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              className="hub-search"
              type="search"
              placeholder="Search templates"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search templates"
            />
          </label>
          <button type="button" className="hub-create-btn" onClick={() => setCreateOpen(true)}>
            <span className="hub-create-icon" aria-hidden="true">+</span>
            Create New Template
          </button>
        </div>
      )}

      {!loading && (
        <section className="hub-library">
          <div className="hub-library-bar">
            <h3>
              Created Templates <span>({templates.length})</span>
            </h3>
          </div>

          {emptyLibrary ? (
            <div className="hub-empty-library">
              <p>No templates yet. Create one to get started.</p>
              <button type="button" className="hub-create-btn" onClick={() => setCreateOpen(true)}>
                <span className="hub-create-icon" aria-hidden="true">+</span>
                Create New Template
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="tm-note">No templates match that search.</p>
          ) : (
            <div className="hub-grid">
              {filtered.map((template) => (
                <article className="hub-card" key={template.id}>
                  <button
                    type="button"
                    className="hub-card-x"
                    aria-label={`Delete ${template.name}`}
                    disabled={deletingId === template.id}
                    onClick={() => void onDelete(template)}
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="hub-card-body"
                    onClick={() => navigate(`/templates/${template.id}/edit`)}
                  >
                    <div className="hub-card-top">
                      <span className="hub-card-mark" aria-hidden="true">
                        {template.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <h4>{template.name}</h4>
                        <p>{categorySubtitle(template.category)}</p>
                      </div>
                    </div>
                    <div className="hub-card-stats">
                      <span>v{template.version}</span>
                      <span>{template.fields.length} fields</span>
                      {fieldMix(template).header > 0 && <span>{fieldMix(template).header} header</span>}
                      {fieldMix(template).line > 0 && <span>{fieldMix(template).line} line</span>}
                    </div>
                    {template.fields.length > 0 && (
                      <div className="hub-chip-row">
                        {template.fields.slice(0, 3).map((field) => (
                          <span key={field.id}>{field.name}</span>
                        ))}
                        {template.fields.length > 3 && <span>+{template.fields.length - 3}</span>}
                      </div>
                    )}
                    <p className="hub-card-foot">
                      {template.documentCount > 0
                        ? `Used on ${template.documentCount} document${template.documentCount === 1 ? "" : "s"}`
                        : "Not used on a document yet"}
                      {updatedOn(template.updatedAt) ? ` · Updated ${updatedOn(template.updatedAt)}` : ""}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="hub-set-active"
                    disabled={activatingId === template.id}
                    onClick={() => void onActivate(template)}
                  >
                    {activatingId === template.id ? "Setting…" : "Set as Active"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {createOpen && (
        <div className="hub-modal-backdrop" role="presentation" onClick={() => setCreateOpen(false)}>
          <div
            className="hub-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hub-create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="hub-create-title">Create New Template</h3>
            <p>Name your schema, then configure fields in Template Studio.</p>
            <label className="hub-modal-field">
              Template name
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="hub-modal-field">
              <span className="hub-modal-label">
                Sample documents (select multiple or one by one)
              </span>
              <label className="hub-modal-dropzone">
                <span>📁 Choose sample files (Multiple supported)</span>
                <input
                  type="file"
                  multiple
                  hidden
                  accept={FALLBACK_ACCEPT.join(",")}
                  onChange={(event) => {
                    const added = [...(event.target.files ?? [])];
                    if (added.length) {
                      setCreateFiles((current) => [...current, ...added]);
                    }
                    event.target.value = "";
                  }}
                />
              </label>
              {createFiles.length > 0 && (
                <div className="hub-modal-file-list">
                  {createFiles.map((file, idx) => (
                    <div key={`${file.name}-${idx}`} className="hub-modal-file-chip">
                      <span className="hub-chip-name">{file.name}</span>
                      <span className="hub-chip-size">({Math.round(file.size / 1024)} KB)</span>
                      <button
                        type="button"
                        className="hub-chip-remove"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setCreateFiles((curr) => curr.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="hub-modal-actions">
              <button
                type="button"
                className="hub-btn-ghost"
                onClick={() => {
                  setCreateOpen(false);
                  setCreateFiles([]);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hub-btn-primary"
                onClick={() => {
                  setCreateOpen(false);
                  navigate("/templates/new", {
                    state: {
                      name: createName.trim() || "Untitled template",
                      files: createFiles,
                    },
                  });
                  setCreateFiles([]);
                }}
              >
                {createFiles.length > 1
                  ? `Extract All (${createFiles.length} files simultaneously)`
                  : createFiles.length === 1
                    ? "Extract & Continue"
                    : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
