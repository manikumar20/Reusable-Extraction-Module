import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { TemplateField } from "./types";

type FieldListProps = {
  fields: TemplateField[];
  selectedId: string | null;
  activeFileName?: string;
  isExtracting?: boolean;
  onSelect: (id: string) => void;
  onAccept: (id: string) => void;
  onAcceptAll: () => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (name?: string) => void;
};

const fieldDescription = (field: TemplateField) => {
  if (field.hint?.trim()) return field.hint.trim();
  if (field.sampleValue?.trim()) return `Sample: ${field.sampleValue.trim()}`;
  if (field.level === "header") return "Header field from the document.";
  if (field.level === "line") return "Line-item field from the document.";
  return field.type ? `${field.type} field` : undefined;
};

export const FieldList = ({
  fields,
  selectedId,
  activeFileName,
  isExtracting = false,
  onSelect,
  onAccept,
  onAcceptAll,
  onReject,
  onDelete,
  onAdd,
}: FieldListProps) => {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const customInputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const customId = useId();

  const needle = query.trim().toLowerCase();
  const matches = (field: TemplateField) =>
    !needle || field.name.toLowerCase().includes(needle);

  const suggested = useMemo(
    () => fields.filter((field) => Boolean(field.suggested)),
    [fields],
  );
  const inSchema = useMemo(
    () => fields.filter((field) => !field.suggested),
    [fields],
  );
  const visibleSuggested = suggested.filter(matches);
  const visibleInSchema = inSchema.filter(matches);

  const submitCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    onAdd(name);
    setCreating(false);
    setDraftName("");
  };

  const onCustomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitCreate();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setCreating(false);
      setDraftName("");
    }
  };

  const onCustomSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitCreate();
  };

  return (
    <aside className="tm-panel tm-fields sfb-panel" aria-label="Schema field builder">
      <header className="sfb-head">
        <h2>Schema field builder</h2>
        <p>
          {activeFileName ? (
            <>
              Fields extracted from <strong>{activeFileName}</strong>
            </>
          ) : (
            "Select a sample file on the right to review its fields."
          )}
        </p>
      </header>

      <div className="sfb-search">
        <label className="sr-only" htmlFor={searchId}>
          Search fields
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search fields"
        />
      </div>

      {isExtracting && (
        <div className="tm-extract-banner">
          <div className="tm-extract-banner-head">
            <span className="tm-extract-spinner" aria-hidden="true" />
            <strong>Extracting this file</strong>
          </div>
          <p>
            {activeFileName
              ? `Analyzing “${activeFileName}”. Fields will appear below when ready.`
              : "Analyzing the selected document. Fields will appear below when ready."}
          </p>
          <div className="tm-extract-progress-bar">
            <div className="tm-extract-progress-indeterminate" />
          </div>
        </div>
      )}

      <div className="tm-field-scroll sfb-scroll">
        {fields.length === 0 && !isExtracting ? (
          <div className="tm-empty-card">
            <strong>No fields yet</strong>
            <p>
              {activeFileName
                ? "No fields were extracted from this file. Pick another sample or add a custom field."
                : "Upload a sample on the right, then select it to review fields."}
            </p>
          </div>
        ) : null}

        {fields.length === 0 && isExtracting ? (
          <div className="tm-empty-card tm-extracting-empty">
            <span className="tm-extract-spinner large" aria-hidden="true" />
            <strong>Extracting schema fields…</strong>
            <p>
              {activeFileName
                ? `AI is analyzing “${activeFileName}”.`
                : "AI is analyzing the selected sample."}
            </p>
          </div>
        ) : null}

        {suggested.length > 0 && (
          <section className="sfb-section" aria-labelledby="sfb-suggested-heading">
            <div className="sfb-section-head">
              <div className="sfb-section-title">
                <h3 id="sfb-suggested-heading">Suggested fields</h3>
                <span className="sfb-badge suggest" aria-label={`${suggested.length} suggested`}>
                  {suggested.length}
                </span>
              </div>
              <button type="button" className="sfb-add-all" onClick={onAcceptAll}>
                Add all
              </button>
            </div>

            {visibleSuggested.length === 0 ? (
              <p className="sfb-empty-note">No suggestions match.</p>
            ) : (
              <ul className="sfb-grid">
                {visibleSuggested.map((field) => {
                  const label = field.name.trim() || "Untitled field";
                  const description = fieldDescription(field);
                  return (
                    <li
                      key={field.id}
                      className={
                        selectedId === field.id ? "sfb-chip suggested selected" : "sfb-chip suggested"
                      }
                    >
                      <button
                        type="button"
                        className="sfb-chip-main"
                        onClick={() => onSelect(field.id)}
                      >
                        <span className="sfb-chip-name">{label}</span>
                        {description ? <span className="sfb-chip-desc">{description}</span> : null}
                      </button>
                      <div className="sfb-chip-actions">
                        <button
                          type="button"
                          className="sfb-add-btn"
                          aria-label={`Add ${label}`}
                          onClick={() => onAccept(field.id)}
                        >
                          + Add
                        </button>
                        <button
                          type="button"
                          className="sfb-x suggest"
                          aria-label={`Dismiss ${label}`}
                          onClick={() => onReject(field.id)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <section className="sfb-section" aria-labelledby="sfb-schema-heading">
          <div className="sfb-section-head">
            <div className="sfb-section-title">
              <h3 id="sfb-schema-heading">In your schema</h3>
              <span className="sfb-badge cool" aria-label={`${inSchema.length} in schema`}>
                {inSchema.length}
              </span>
            </div>
          </div>

          <ul className="sfb-grid">
            {visibleInSchema.map((field) => {
              const label = field.name.trim() || "Untitled field";
              const description = fieldDescription(field);
              return (
                <li
                  key={field.id}
                  className={selectedId === field.id ? "sfb-chip in selected" : "sfb-chip in"}
                >
                  <span className="sfb-check" aria-hidden="true">
                    ✓
                  </span>
                  <button
                    type="button"
                    className="sfb-chip-main"
                    onClick={() => onSelect(field.id)}
                  >
                    <span className="sfb-chip-name">{label}</span>
                    {description ? <span className="sfb-chip-desc">{description}</span> : null}
                  </button>
                  <button
                    type="button"
                    className="sfb-x cool"
                    aria-label={`Remove ${label}`}
                    onClick={() => onDelete(field.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}

            <li className="sfb-custom-slot">
              {creating ? (
                <form className="sfb-custom-form" onSubmit={onCustomSubmit}>
                  <label className="sr-only" htmlFor={customId}>
                    Field name
                  </label>
                  <input
                    id={customId}
                    ref={customInputRef}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={onCustomKeyDown}
                    placeholder="Field name"
                    autoFocus
                  />
                  <button type="submit" className="sfb-custom-submit">
                    Add
                  </button>
                  <button
                    type="button"
                    className="sfb-x cool"
                    aria-label="Cancel custom field"
                    onClick={() => {
                      setCreating(false);
                      setDraftName("");
                    }}
                  >
                    ×
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="sfb-custom-add"
                  onClick={() => setCreating(true)}
                >
                  + Add custom field
                </button>
              )}
            </li>
          </ul>

          {needle && visibleInSchema.length === 0 && inSchema.length > 0 ? (
            <p className="sfb-empty-note">No schema fields match.</p>
          ) : null}
        </section>
      </div>
    </aside>
  );
};
