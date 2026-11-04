import { useRef } from "react";
import type { TemplateField } from "./types";

type FieldListProps = {
  fields: TemplateField[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (fields: TemplateField[]) => void;
  onAdd: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
};

export const FieldList = ({
  fields,
  selectedId,
  onSelect,
  onReorder,
  onAdd,
  onAccept,
  onReject,
  onDelete,
}: FieldListProps) => {
  const dragIndex = useRef(-1);
  const headerFields = fields.filter((field) => field.level === "header");
  const lineFields = fields.filter((field) => field.level !== "header");

  const rowClass = (field: TemplateField) => {
    const parts = ["tm-field-row"];
    if (field.id === selectedId) parts.push("selected");
    if (field.catalogKey && !field.suggested) parts.push("matched");
    else if (field.suggested) parts.push("suggested");
    else parts.push("custom");
    return parts.join(" ");
  };

  const renderRow = (field: TemplateField, compact = false) => {
    const index = fields.indexOf(field);
    return (
      <div key={field.id} className={compact ? "tm-field-item compact" : "tm-field-item"}>
        <div className={rowClass(field)}>
          <button
            type="button"
            draggable
            className="tm-field-main"
            onClick={() => onSelect(field.id)}
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              const from = dragIndex.current;
              if (from < 0 || from === index) return;
              const next = [...fields];
              const [moved] = next.splice(from, 1);
              if (!moved) return;
              next.splice(index, 0, moved);
              onReorder(next);
            }}
          >
            <span className="tm-field-name">{field.name || "Untitled field"}</span>
            {!compact && field.catalogKey && !field.suggested && (
              <span className="tm-type matched">Matched</span>
            )}
            {!compact && field.suggested && <span className="tm-type suggested">Suggested</span>}
            {!compact && !field.suggested && !field.catalogKey && <span className="tm-type">Custom</span>}
          </button>
          <div className="tm-field-actions">
            {field.suggested && (
              <button
                type="button"
                className="tm-btn tm-btn-primary tm-field-accept"
                aria-label={`Accept ${field.name || "field"}`}
                title="Accept"
                onClick={() => onAccept(field.id)}
              >
                ✓
              </button>
            )}
            <button
              type="button"
              className="tm-field-x"
              aria-label={field.suggested ? `Reject ${field.name || "field"}` : `Remove ${field.name || "field"}`}
              onClick={() => {
                if (field.suggested) onReject(field.id);
                else onDelete(field.id);
              }}
            >
              ×
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="tm-panel tm-fields">
      <div className="tm-panel-head">
        <h2>Fields · {fields.length}</h2>
        <p className="tm-caption">Header &amp; line fields matched from your samples.</p>
      </div>

      <div className="tm-field-scroll">
        {fields.length === 0 ? (
          <div className="tm-empty-card">
            <strong>No fields yet</strong>
            <p>Upload a sample on the left, or add a field yourself.</p>
          </div>
        ) : (
          <>
            <section className="tm-field-group">
              <div className="tm-field-group-head">
                <h3 className="tm-field-group-title">Header</h3>
                <span className="tm-field-count">{headerFields.length}</span>
              </div>
              {headerFields.length === 0 ? (
                <p className="tm-note tm-line-empty">No header fields yet.</p>
              ) : (
                headerFields.map((field) => renderRow(field))
              )}
            </section>

            <section className="tm-field-group tm-line-group">
              <div className="tm-field-group-head">
                <h3 className="tm-field-group-title">Line items</h3>
                <span className="tm-field-count">{lineFields.length}</span>
              </div>
              {lineFields.length === 0 ? (
                <p className="tm-note tm-line-empty">No line fields yet.</p>
              ) : (
                <div className="tm-line-rail">{lineFields.map((field) => renderRow(field, true))}</div>
              )}
            </section>
          </>
        )}
      </div>

      <div className="tm-field-tools">
        <button type="button" className="tm-btn tm-add" onClick={onAdd}>
          + Add field
        </button>
      </div>
    </aside>
  );
};
