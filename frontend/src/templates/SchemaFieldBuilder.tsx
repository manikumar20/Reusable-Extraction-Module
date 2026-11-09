import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

export type SchemaFieldStatus = "in" | "suggested";

export type SchemaBuilderField = {
  id: string;
  name: string;
  description?: string;
  status: SchemaFieldStatus;
};

export type SchemaFieldBuilderProps = {
  fileName?: string;
  fields?: SchemaBuilderField[];
  onAdd?: (id: string) => void;
  onRemove?: (id: string) => void;
  onAddAll?: () => void;
  onCreate?: (name: string) => void;
};

const DEMO_FILE_NAME = "medical_record_sample.docx";

const DEMO_FIELDS: SchemaBuilderField[] = [
  { id: "in-customer", name: "Customer", description: "Organisation the document belongs to.", status: "in" },
  { id: "in-document-title", name: "Document Title", description: "Printed title at the top of the form.", status: "in" },
  { id: "in-buyer", name: "Buyer", description: "Party purchasing goods or services.", status: "in" },
  { id: "in-issue-date", name: "Issue Date", description: "Date the document was issued.", status: "in" },
  {
    id: "in-closing",
    name: "Closing Date / Time",
    description: "Deadline by which submissions must be received.",
    status: "in",
  },
  { id: "in-reference", name: "Reference Number", description: "Unique id printed on the document.", status: "in" },
  { id: "in-contact-person", name: "Contact Person", description: "Named person to reach about this file.", status: "in" },
  { id: "in-contact-email", name: "Contact Email", description: "Email address for follow-up questions.", status: "in" },
  { id: "in-estimated-value", name: "Estimated Value", description: "Approximate monetary value of the request.", status: "in" },
  { id: "in-currency", name: "Currency", description: "Currency code used for money amounts.", status: "in" },
  { id: "in-delivery", name: "Delivery Location", description: "Where goods or services should arrive.", status: "in" },
  { id: "in-submission", name: "Submission Mode", description: "How responses are expected to be sent.", status: "in" },
  { id: "in-validity", name: "Validity Period", description: "How long quoted terms remain valid.", status: "in" },
  { id: "in-department", name: "Department", description: "Internal team owning this request.", status: "in" },
  {
    id: "sug-patient-record-type",
    name: "Patient Record Type",
    description: "Kind of clinical record in this file.",
    status: "suggested",
  },
  { id: "sug-emd-amount", name: "EMD Amount", description: "Earnest money deposit required with the bid.", status: "suggested" },
  {
    id: "sug-prebid",
    name: "Pre-bid Meeting Date",
    description: "Scheduled date for the pre-bid meeting.",
    status: "suggested",
  },
  {
    id: "sug-eligibility",
    name: "Eligibility Criteria",
    description: "Rules a bidder must meet to qualify.",
    status: "suggested",
  },
  { id: "sug-penalty", name: "Penalty Clause", description: "Penalty applied for delayed performance.", status: "suggested" },
  {
    id: "sug-contract-duration",
    name: "Contract Duration",
    description: "Length of the proposed contract term.",
    status: "suggested",
  },
];

const slugId = (name: string) =>
  `custom-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "field"}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * SchemaFieldBuilder
 *
 * Usage:
 * ```tsx
 * import { SchemaFieldBuilder } from "./SchemaFieldBuilder";
 *
 * // Demo (no props)
 * <SchemaFieldBuilder />
 *
 * // Controlled
 * <SchemaFieldBuilder
 *   fileName="invoice.pdf"
 *   fields={fields}
 *   onAdd={(id) => moveToSchema(id)}
 *   onRemove={(id) => removeFromSchema(id)}
 *   onAddAll={() => acceptAllSuggestions()}
 *   onCreate={(name) => addCustomField(name)}
 * />
 * ```
 */
export const SchemaFieldBuilder = ({
  fileName = DEMO_FILE_NAME,
  fields: fieldsProp,
  onAdd,
  onRemove,
  onAddAll,
  onCreate,
}: SchemaFieldBuilderProps = {}) => {
  const [fields, setFields] = useState<SchemaBuilderField[]>(() => fieldsProp ?? DEMO_FIELDS);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const customInputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const customId = useId();

  useEffect(() => {
    if (fieldsProp) setFields(fieldsProp);
  }, [fieldsProp]);

  useEffect(() => {
    if (creating) customInputRef.current?.focus();
  }, [creating]);

  const needle = query.trim().toLowerCase();
  const matches = (field: SchemaBuilderField) =>
    !needle || field.name.toLowerCase().includes(needle);

  const suggested = useMemo(
    () => fields.filter((field) => field.status === "suggested"),
    [fields],
  );
  const inSchema = useMemo(
    () => fields.filter((field) => field.status === "in"),
    [fields],
  );
  const visibleSuggested = suggested.filter(matches);
  const visibleInSchema = inSchema.filter(matches);

  const addField = (id: string) => {
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, status: "in" as const } : field)),
    );
    onAdd?.(id);
  };

  const addAll = () => {
    const ids = suggested.map((field) => field.id);
    setFields((current) =>
      current.map((field) =>
        field.status === "suggested" ? { ...field, status: "in" as const } : field,
      ),
    );
    if (onAddAll) onAddAll();
    else ids.forEach((id) => onAdd?.(id));
  };

  const dismissSuggested = (id: string) => {
    setFields((current) => current.filter((field) => field.id !== id));
    onRemove?.(id);
  };

  const removeFromSchema = (id: string) => {
    setFields((current) => current.filter((field) => field.id !== id));
    onRemove?.(id);
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraftName("");
  };

  const submitCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    const next: SchemaBuilderField = {
      id: slugId(name),
      name,
      description: "Custom field you added.",
      status: "in",
    };
    setFields((current) => [...current, next]);
    onCreate?.(name);
    cancelCreate();
  };

  const onCustomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitCreate();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelCreate();
    }
  };

  const onCustomSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitCreate();
  };

  return (
    <section
      className="sfb mx-auto w-full max-w-[680px] rounded-2xl border border-[var(--sfb-line)] bg-[var(--sfb-card)] p-[22px] text-[var(--sfb-ink)] shadow-sm"
      style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}
      aria-label="Schema field builder"
    >
      <style>{`
        .sfb {
          --sfb-page: #eef1f6;
          --sfb-card: #ffffff;
          --sfb-ink: #0f172a;
          --sfb-muted: #64748b;
          --sfb-line: #e2e8f0;
          --sfb-brand: #2547d0;
          --sfb-brand-soft: #e8edff;
          --sfb-amber: #15803d;
          --sfb-amber-soft: #ecfdf3;
          --sfb-amber-line: #4ade80;
          --sfb-focus: #2547d0;
        }
        @media (prefers-color-scheme: dark) {
          .sfb {
            --sfb-page: #0b1220;
            --sfb-card: #141b2e;
            --sfb-ink: #eef2ff;
            --sfb-muted: #94a3b8;
            --sfb-line: #2a3550;
            --sfb-brand: #7c97ff;
            --sfb-brand-soft: #1f2b57;
            --sfb-amber: #4ade80;
            --sfb-amber-soft: rgba(22, 163, 74, 0.14);
            --sfb-amber-line: rgba(74, 222, 128, 0.55);
            --sfb-focus: #7c97ff;
          }
        }
        @keyframes sfb-in {
          from { opacity: 0; transform: scale(0.94); }
          to { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .sfb-chip-in { animation: sfb-in 200ms ease-out; }
        }
        .sfb :focus-visible {
          outline: 2px solid var(--sfb-focus);
          outline-offset: 2px;
        }
      `}</style>

      <header className="mb-4">
        <h2 className="m-0 text-[19px] font-bold leading-tight tracking-tight text-[var(--sfb-ink)]">
          Schema field builder
        </h2>
        <p className="mt-1 mb-0 text-[13px] leading-snug text-[var(--sfb-muted)]">
          Fields extracted from <strong className="font-semibold text-[var(--sfb-ink)]">{fileName}</strong>
        </p>
      </header>

      <div className="mb-5">
        <label className="sr-only" htmlFor={searchId}>
          Search fields
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search fields"
          className="w-full rounded-xl border border-transparent bg-[#f1f5f9] px-3.5 py-2.5 text-[14px] text-[var(--sfb-ink)] placeholder:text-[var(--sfb-muted)] dark:bg-[#1a2238]"
        />
      </div>

      {suggested.length > 0 && (
        <section className="mb-5" aria-labelledby="sfb-suggested-heading">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h3
                id="sfb-suggested-heading"
                className="m-0 text-[13px] font-semibold text-[var(--sfb-ink)]"
              >
                Suggested fields
              </h3>
              <span
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--sfb-amber-soft)] px-1.5 text-[11px] font-semibold text-[var(--sfb-amber)]"
                aria-label={`${suggested.length} suggested`}
              >
                {suggested.length}
              </span>
            </div>
            <button
              type="button"
              onClick={addAll}
              className="shrink-0 rounded-md bg-transparent px-1.5 py-1 text-[13px] font-semibold text-[var(--sfb-amber)] hover:underline"
            >
              Add all
            </button>
          </div>

          {visibleSuggested.length === 0 ? (
            <p className="m-0 text-[13px] text-[var(--sfb-muted)]">No suggestions match.</p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-2.5 p-0">
              {visibleSuggested.map((field) => (
                <li
                  key={field.id}
                  className="sfb-chip-in flex items-start gap-2 rounded-xl border border-dashed border-[var(--sfb-amber-line)] bg-[var(--sfb-amber-soft)] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[14px] font-bold leading-snug text-[var(--sfb-ink)]">
                      {field.name}
                    </p>
                    {field.description ? (
                      <p className="mt-0.5 mb-0 line-clamp-2 text-[12px] leading-snug text-[var(--sfb-muted)]">
                        {field.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => addField(field.id)}
                      aria-label={`Add ${field.name}`}
                      className="rounded-full border border-[var(--sfb-amber)] bg-transparent px-2.5 py-0.5 text-[12px] font-semibold text-[var(--sfb-amber)]"
                    >
                      + Add
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissSuggested(field.id)}
                      aria-label={`Dismiss ${field.name}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--sfb-amber-line)] bg-transparent text-[14px] leading-none text-[var(--sfb-amber)]"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="sfb-schema-heading">
        <div className="mb-2.5 flex items-center gap-2">
          <h3 id="sfb-schema-heading" className="m-0 text-[13px] font-semibold text-[var(--sfb-ink)]">
            In your schema
          </h3>
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e2e8f0] px-1.5 text-[11px] font-semibold text-[var(--sfb-muted)] dark:bg-[#2a3550]"
            aria-label={`${inSchema.length} in schema`}
          >
            {inSchema.length}
          </span>
        </div>

        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-2.5 p-0">
          {visibleInSchema.map((field) => (
            <li
              key={field.id}
              className="sfb-chip-in flex items-start gap-2 rounded-xl bg-[var(--sfb-brand-soft)] px-3 py-2.5 text-[var(--sfb-brand)]"
            >
              <span className="mt-0.5 shrink-0 text-[13px] font-bold" aria-hidden="true">
                ✓
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[14px] font-bold leading-snug text-[var(--sfb-brand)]">
                  {field.name}
                </p>
                {field.description ? (
                  <p className="mt-0.5 mb-0 line-clamp-2 text-[12px] leading-snug text-[var(--sfb-muted)]">
                    {field.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => removeFromSchema(field.id)}
                aria-label={`Remove ${field.name}`}
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-transparent text-[14px] leading-none text-[var(--sfb-brand)]"
              >
                ×
              </button>
            </li>
          ))}

          <li className="min-h-[52px]">
            {creating ? (
              <form
                onSubmit={onCustomSubmit}
                className="flex h-full min-h-[52px] items-center gap-2 rounded-xl border border-dashed border-[var(--sfb-line)] bg-transparent px-2.5 py-2"
              >
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
                  className="min-w-0 flex-1 rounded-lg border border-[var(--sfb-line)] bg-transparent px-2.5 py-1.5 text-[13px] text-[var(--sfb-ink)] placeholder:text-[var(--sfb-muted)]"
                />
                <button
                  type="submit"
                  className="rounded-full bg-[var(--sfb-brand)] px-3 py-1 text-[12px] font-semibold text-white"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={cancelCreate}
                  aria-label="Cancel custom field"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[14px] leading-none text-[var(--sfb-muted)]"
                >
                  ×
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-full min-h-[52px] w-full items-center justify-center rounded-xl border border-dashed border-[var(--sfb-line)] bg-transparent px-3 py-2.5 text-[13px] font-semibold text-[var(--sfb-muted)] hover:border-[var(--sfb-brand)] hover:text-[var(--sfb-brand)]"
              >
                + Add custom field
              </button>
            )}
          </li>
        </ul>

        {needle && visibleInSchema.length === 0 && inSchema.length > 0 ? (
          <p className="mt-2 mb-0 text-[13px] text-[var(--sfb-muted)]">No schema fields match.</p>
        ) : null}
      </section>
    </section>
  );
};

export default SchemaFieldBuilder;
