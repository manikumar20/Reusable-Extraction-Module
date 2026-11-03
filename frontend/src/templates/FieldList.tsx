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
  const matched = fields.filter((field) => field.catalogKey && !field.suggested);
  const suggested = fields.filter((field) => field.suggested);
  const custom = fields.filter((field) => !field.catalogKey && !field.suggested);

  const rowClass = (field: TemplateField) => {
    const parts = ["tm-field-row"];
    if (field.id === selectedId) parts.push("selected");
    if (field.catalogKey && !field.suggested) parts.push("matched");
    else if (field.suggested) parts.push("suggested");
    else parts.push("custom");
    return parts.join(" ");
  };

  const renderRow = (field: TemplateField, index: number) => (
    <div key={field.id} className="tm-field-item">
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
          {!field.suggested && field.catalogKey && <span className="tm-type matched">Matched</span>}
          {field.suggested && <span className="tm-type suggested">Suggested</span>}
          {!field.suggested && !field.catalogKey && <span className="tm-type">Custom</span>}
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

  return (
    <section className="tm-panel tm-fields">
      <div className="tm-panel-head">
        <h2>Fields · {fields.length}</h2>
        <p className="tm-caption">
          Matched = found in fields.ts. Suggested = in the file but not in the catalogue — ✓ accept or × reject.
        </p>
      </div>
      <div className="tm-field-scroll">
        {fields.length === 0 && (
          <div className="tm-empty-card">
            <strong>No fields yet</strong>
            <p>
              Upload a sample to match catalogue fields or get suggestions. If the file finished as
              “No fields”, it may not contain labelled data — try another sample or add a field
              manually.
            </p>
          </div>
        )}

        {matched.length > 0 && (
          <div className="tm-field-group">
            <h3 className="tm-field-group-title">Matched from catalogue</h3>
            {matched.map((field) => renderRow(field, fields.indexOf(field)))}
          </div>
        )}

        {suggested.length > 0 && (
          <div className="tm-field-group">
            <h3 className="tm-field-group-title">Suggested (not in catalogue)</h3>
            {suggested.map((field) => renderRow(field, fields.indexOf(field)))}
          </div>
        )}

        {custom.length > 0 && (
          <div className="tm-field-group">
            <h3 className="tm-field-group-title">Accepted / custom</h3>
            {custom.map((field) => renderRow(field, fields.indexOf(field)))}
          </div>
        )}
      </div>
      <div className="tm-field-tools">
        <button type="button" className="tm-btn tm-add" onClick={onAdd}>
          + Add field
        </button>
      </div>
    </section>
  );
};
