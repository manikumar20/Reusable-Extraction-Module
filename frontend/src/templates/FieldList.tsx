import { useRef } from "react";
import type { TemplateField } from "./types";

type FieldListProps = {
  fields: TemplateField[];
  selectedId: string | null;
  query?: string;
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
  query = "",
  onSelect,
  onReorder,
  onAdd,
  onAccept,
  onReject,
  onDelete,
}: FieldListProps) => {
  const dragIndex = useRef(-1);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? fields.filter((field) => {
        const hay = field.name.toLowerCase();
        return hay.includes(needle);
      })
    : fields;

  const rowClass = (field: TemplateField) => {
    const parts = ["tm-schema-row"];
    if (field.id === selectedId) parts.push("selected");
    if (field.catalogKey && !field.suggested) parts.push("matched");
    else if (field.suggested) parts.push("suggested");
    return parts.join(" ");
  };

  return (
    <aside className="tm-panel tm-fields">
      <div className="tm-panel-head">
        <div>
          <h2>Schema Field Builder</h2>
          <p className="tm-caption">Structured targets mapped to your sample document.</p>
        </div>
        <span className="tm-field-count">{fields.length}</span>
      </div>

      <div className="tm-field-scroll">
        {visible.length === 0 ? (
          <div className="tm-empty-card">
            <strong>{fields.length === 0 ? "No fields yet" : "No matches"}</strong>
            <p>
              {fields.length === 0
                ? "Upload a sample on the right, or add a custom target field."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <div className="tm-schema-list">
            {visible.map((field) => {
              const index = fields.indexOf(field);
              const label = field.name.trim() || "Untitled field";

              return (
                <div key={field.id} className="tm-schema-item">
                  <div className={rowClass(field)}>
                    <button
                      type="button"
                      draggable
                      className="tm-schema-main"
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
                      <span className="tm-schema-name">{label}</span>
                    </button>
                    <div className="tm-field-actions">
                      {field.suggested && (
                        <button
                          type="button"
                          className="tm-confirm"
                          aria-label={`Confirm ${label}`}
                          title="Confirm"
                          onClick={() => onAccept(field.id)}
                        >
                          Confirm
                        </button>
                      )}
                      <button
                        type="button"
                        className="tm-field-x"
                        aria-label={
                          field.suggested
                            ? `Reject ${field.name || "field"}`
                            : `Remove ${field.name || "field"}`
                        }
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
            })}
          </div>
        )}
      </div>

      <div className="tm-field-tools">
        <button type="button" className="tm-add-dashed" onClick={onAdd}>
          + Add Custom Target Field
        </button>
      </div>
    </aside>
  );
};
