import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FALLBACK_ACCEPT } from "@/lib/format";
import { createExtractionBatch } from "@/services/batches";
import {
  activateTemplate,
  clearActiveTemplate,
  deleteTemplate,
  listTemplates,
  saveTemplate,
} from "@/services/templateService";
import "@/styles/templates.css";
import {
  clearRememberedTemplate,
  rememberTemplate,
  type TemplateSummary,
} from "@/types/templates";

type StatusFilter = "all" | "active" | "ready";

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "active", label: "Active" },
  { id: "ready", label: "Ready" },
];

const updatedOn = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const isDraft = (template: TemplateSummary) => !template.published;

const statusOf = (template: TemplateSummary) => {
  if (template.active) return "active" as const;
  if (isDraft(template)) return "draft" as const;
  return "ready" as const;
};

const statusLabel = (template: TemplateSummary) => {
  const status = statusOf(template);
  if (status === "active") return "Active";
  if (status === "draft") return "Draft";
  return "Ready";
};

export const TemplatesPage = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("Untitled template");
  const [createFiles, setCreateFiles] = useState<File[]>([]);

  useEffect(() => {
    document.title = "Templates · ExtractIQ";
  }, []);

  useEffect(() => {
    if (!statusOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!statusRef.current?.contains(event.target as Node)) setStatusOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStatusOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [statusOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTemplates({ query: "" })
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
    return templates
      .filter((template) => {
        if (statusFilter === "active" && statusOf(template) !== "active") return false;
        if (statusFilter === "ready" && statusOf(template) !== "ready") return false;
        if (!needle) return true;
        return template.name.toLowerCase().includes(needle);
      })
      .sort((left, right) => Number(right.active) - Number(left.active));
  }, [templates, query, statusFilter]);

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

  const onCreateContinue = async () => {
    setCreating(true);
    setError("");
    try {
      const draft = await saveTemplate({
        name: createName.trim() || "Untitled template",
        fields: [],
      });
      const samples = [...createFiles];
      setCreateOpen(false);
      setCreateFiles([]);

      if (samples.length) {
        try {
          await createExtractionBatch({
            files: samples,
            jobName: `${draft.name} samples`,
            templateId: draft.id,
          });
        } catch {
          // Builder still opens even if batch creation fails.
        }
      }

      navigate(`/templates/${draft.id}/edit`, {
        state: {
          name: draft.name,
          files: samples,
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Draft template could not be created.");
    } finally {
      setCreating(false);
    }
  };

  const emptyLibrary = !loading && templates.length === 0;

  return (
    <section className="tm hub">
      <header className="hub-page-head">
        <div>
          <h1>Templates</h1>
          <p>Choose the field schema used for extraction.</p>
        </div>
      </header>

      {error && <p className="tm-error">{error}</p>}
      {loading && <p className="tm-note">Loading templates…</p>}

      {!loading && !active && !emptyLibrary && (
        <div className="hub-empty-active">
          <strong>No active template</strong>
          <p>Set one as active to use it on Extract &amp; Ingest.</p>
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
              placeholder="Search templates..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search templates"
            />
          </label>

          <div className="hub-status-menu" ref={statusRef}>
            <button
              type="button"
              className={`hub-status-trigger${statusOpen ? " open" : ""}`}
              aria-haspopup="listbox"
              aria-expanded={statusOpen}
              onClick={() => setStatusOpen((open) => !open)}
            >
              <span>{STATUS_OPTIONS.find((option) => option.id === statusFilter)?.label}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
            {statusOpen ? (
              <ul className="hub-status-list" role="listbox" aria-label="Status">
                {STATUS_OPTIONS.map((option) => {
                  const selected = option.id === statusFilter;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`hub-status-option${selected ? " selected" : ""}`}
                        onClick={() => {
                          setStatusFilter(option.id);
                          setStatusOpen(false);
                        }}
                      >
                        <span>{option.label}</span>
                        {selected ? (
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m3.5 8.2 3 3 6-6.4" />
                          </svg>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <button type="button" className="hub-create-btn" onClick={() => setCreateOpen(true)}>
            <span className="hub-create-icon" aria-hidden="true">
              +
            </span>
            New template
          </button>
        </div>
      )}

      {!loading && (
        <section className="hub-library">
          {emptyLibrary ? (
            <div className="hub-empty-library">
              <strong>No templates yet</strong>
              <p>Create a template to define the fields you want extracted.</p>
              <button type="button" className="hub-create-btn" onClick={() => setCreateOpen(true)}>
                <span className="hub-create-icon" aria-hidden="true">
                  +
                </span>
                New template
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="tm-note">No templates match that search or filter.</p>
          ) : (
            <div className="hub-table-wrap">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th scope="col">Template</th>
                    <th scope="col">Status</th>
                    <th scope="col">Fields</th>
                    <th scope="col">Documents</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((template) => {
                    const switching =
                      activatingId === template.id || (template.active && deactivating);
                    return (
                      <tr key={template.id} className={template.active ? "is-active" : undefined}>
                        <td>
                          <button
                            type="button"
                            className="hub-table-name"
                            onClick={() => navigate(`/templates/${template.id}/edit`)}
                          >
                            {template.name}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`hub-switch${template.active ? " on" : ""}`}
                            role="switch"
                            aria-checked={template.active}
                            aria-label={`${template.name} is ${statusLabel(template)}`}
                            disabled={switching || (!template.active && template.fields.length === 0)}
                            title={
                              !template.active && template.fields.length === 0
                                ? "Add fields before setting this draft as active"
                                : template.active
                                  ? "Deactivate"
                                  : "Set as active"
                            }
                            onClick={() =>
                              void (template.active ? onDeactivate() : onActivate(template))
                            }
                          />
                        </td>
                        <td>{template.fields.length}</td>
                        <td>{template.documentCount}</td>
                        <td>{updatedOn(template.updatedAt) || "—"}</td>
                        <td>
                          <div className="docs-actions">
                            <button
                              type="button"
                              className="docs-action edit"
                              aria-label={`Edit ${template.name}`}
                              title="Edit"
                              onClick={() => navigate(`/templates/${template.id}/edit`)}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M13.5 6.5 17.5 10.5" />
                                <path d="M4.5 19.5 8 18.5 18.2 8.3a1.6 1.6 0 0 0-2.3-2.3L5.7 16.2 4.5 19.5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="docs-action danger"
                              aria-label={`Delete ${template.name}`}
                              title="Delete"
                              disabled={deletingId === template.id}
                              onClick={() => void onDelete(template)}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M5 7.5h14" />
                                <path d="M9.5 7.5V6h5v1.5" />
                                <path d="M7.5 7.5 8.2 18h7.6l.7-10.5" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
            <h3 id="hub-create-title">New template</h3>
            <p>Name the schema, then add fields in Template Studio.</p>
            <label className="hub-modal-field">
              Template name
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="hub-modal-field">
              <span className="hub-modal-label">Sample documents (optional)</span>
              <label className="hub-modal-dropzone">
                <span>Choose sample files</span>
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
                        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                          <path
                            d="M4 4l8 8M12 4l-8 8"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
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
                disabled={creating}
                onClick={() => void onCreateContinue()}
              >
                {creating ? "Creating…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
