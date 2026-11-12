import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

export type SchemaFieldStatus = "in" | "suggested";

export type SchemaBuilderField = {
  id: string;
  name: string;
  description?: string;
  /** Extracted sample value shown in the value well. */
  value?: string;
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
  {
    id: "in-customer",
    name: "Customer Name",
    description: "Organisation the document belongs to.",
    value: "METRO HEALTH MEDICAL CENTER",
    status: "in",
  },
  {
    id: "in-document-title",
    name: "Document Title",
    description: "Printed title at the top of the form.",
    value: "Discharge Summary & Clinical Record",
    status: "in",
  },
  {
    id: "in-buyer",
    name: "Buyer",
    description: "Party purchasing goods or services.",
    value: "Metro Health Procurement",
    status: "in",
  },
  {
    id: "in-issue-date",
    name: "Issue Date",
    description: "Date the document was issued.",
    value: "14 Mar 2026",
    status: "in",
  },
  {
    id: "in-closing",
    name: "Closing Date / Time",
    description: "Deadline by which submissions must be received.",
    value: "28 Mar 2026 · 17:00",
    status: "in",
  },
  {
    id: "in-reference",
    name: "Reference Number",
    description: "Unique id printed on the document.",
    value: "MR-2026-08421",
    status: "in",
  },
  {
    id: "in-contact-person",
    name: "Contact Person",
    description: "Named person to reach about this file.",
    value: "Dr. Ananya Mehta",
    status: "in",
  },
  {
    id: "in-contact-email",
    name: "Contact Email",
    description: "Email address for follow-up questions.",
    value: "records@metrohealth.example",
    status: "in",
  },
  {
    id: "in-estimated-value",
    name: "Estimated Value",
    description: "Approximate monetary value of the request.",
    value: "125,000",
    status: "in",
  },
  {
    id: "in-currency",
    name: "Currency",
    description: "Currency code used for money amounts.",
    value: "INR",
    status: "in",
  },
  {
    id: "in-delivery",
    name: "Delivery Location",
    description: "Where goods or services should arrive.",
    value: "Ward 4B · Metro Health",
    status: "in",
  },
  {
    id: "in-submission",
    name: "Submission Mode",
    description: "How responses are expected to be sent.",
    value: "Online portal",
    status: "in",
  },
  {
    id: "in-validity",
    name: "Validity Period",
    description: "How long quoted terms remain valid.",
    value: "90 days",
    status: "in",
  },
  {
    id: "in-department",
    name: "Department",
    description: "Internal team owning this request.",
    value: "Cardiology",
    status: "in",
  },
  {
    id: "sug-patient-record-type",
    name: "Patient Record Type",
    description: "Kind of clinical record in this file.",
    value: "Inpatient discharge",
    status: "suggested",
  },
  {
    id: "sug-emd-amount",
    name: "EMD Amount",
    description: "Earnest money deposit required with the bid.",
    value: "25,000 INR",
    status: "suggested",
  },
  {
    id: "sug-prebid",
    name: "Pre-bid Meeting Date",
    description: "Scheduled date for the pre-bid meeting.",
    value: "20 Mar 2026",
    status: "suggested",
  },
  {
    id: "sug-eligibility",
    name: "Eligibility Criteria",
    description: "Rules a bidder must meet to qualify.",
    value: "ISO 13485 certified vendor",
    status: "suggested",
  },
  {
    id: "sug-penalty",
    name: "Penalty Clause",
    description: "Penalty applied for delayed performance.",
    value: "0.5% per week of delay",
    status: "suggested",
  },
  {
    id: "sug-contract-duration",
    name: "Contract Duration",
    description: "Length of the proposed contract term.",
    value: "24 months",
    status: "suggested",
  },
];

const slugId = (name: string) =>
  `custom-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "field"}-${Math.random().toString(36).slice(2, 7)}`;

const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
    <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/**
 * SchemaFieldBuilder
 *
 * Usage:
 * ```tsx
 * import { SchemaFieldBuilder } from "./SchemaFieldBuilder";
 *
 * <SchemaFieldBuilder />
 *
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
    !needle ||
    field.name.toLowerCase().includes(needle) ||
    (field.value ?? "").toLowerCase().includes(needle) ||
    (field.description ?? "").toLowerCase().includes(needle);

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
      value: "",
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

  const fieldValue = (field: SchemaBuilderField) => field.value?.trim() ?? "";

  const FieldCard = ({
    field,
    index,
    variant,
  }: {
    field: SchemaBuilderField;
    index: number;
    variant: "in" | "suggested";
  }) => {
    const value = fieldValue(field);
    const suggestedCard = variant === "suggested";

    return (
      <li
        className={[
          "sfb-chip-in sfb-card rounded-2xl border p-3.5 transition-[border-color,box-shadow] duration-200",
          suggestedCard
            ? "sfb-card-suggested border-dashed border-[var(--sfb-amber-line)] bg-[var(--sfb-amber-soft)]"
            : "border-[var(--sfb-line)] bg-[var(--sfb-soft)]",
        ].join(" ")}
        style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
      >
        {/* Label row — field name only, never the extracted value */}
        <div className="mb-3 flex items-center gap-2.5">
          <span
            className={[
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold",
              suggestedCard
                ? "bg-white/80 text-[var(--sfb-amber)] dark:bg-black/20"
                : "bg-[var(--sfb-brand-soft)] text-[var(--sfb-brand)]",
            ].join(" ")}
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11px] font-semibold tracking-wide text-[var(--sfb-muted)] uppercase">
              Field
            </p>
            <p
              className={[
                "m-0 truncate text-[15px] font-bold leading-snug",
                suggestedCard ? "text-[var(--sfb-ink)]" : "text-[var(--sfb-brand)]",
              ].join(" ")}
            >
              {field.name}
            </p>
          </div>
          {suggestedCard ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => addField(field.id)}
                aria-label={`Add ${field.name}`}
                className="inline-flex items-center gap-1 rounded-xl bg-[var(--sfb-amber)] px-2.5 py-1.5 text-[12px] font-semibold text-white"
              >
                <PlusIcon />
                Add
              </button>
              <button
                type="button"
                onClick={() => dismissSuggested(field.id)}
                aria-label={`Dismiss ${field.name}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/80 text-[var(--sfb-muted)] hover:bg-[var(--sfb-danger-soft)] hover:text-[var(--sfb-danger)] dark:bg-black/20"
              >
                <TrashIcon />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => removeFromSchema(field.id)}
              aria-label={`Remove ${field.name}`}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--sfb-muted)] shadow-[inset_0_0_0_1px_var(--sfb-line)] hover:bg-[var(--sfb-danger-soft)] hover:text-[var(--sfb-danger)] dark:bg-[#10182b]"
            >
              <TrashIcon />
            </button>
          )}
        </div>

        {/* Value row — extracted content only, visually separated from the label */}
        <div>
          <p className="mb-1.5 ml-0.5 text-[11px] font-semibold tracking-wide text-[var(--sfb-muted)] uppercase">
            Value
          </p>
          <div
            className={[
              "rounded-xl border px-3.5 py-3 text-[14px] leading-snug font-semibold",
              value
                ? suggestedCard
                  ? "sfb-value-suggested"
                  : "sfb-value-in"
                : "sfb-value-empty",
            ].join(" ")}
          >
            {value || "No value extracted"}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section
      className="sfb mx-auto w-full max-w-[680px] rounded-2xl border border-[var(--sfb-line)] bg-[var(--sfb-card)] p-5 text-[var(--sfb-ink)] shadow-[0_12px_40px_rgba(15,23,42,0.06)] sm:p-6"
      style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}
      aria-label="Schema field builder"
    >
      <style>{`
        .sfb {
          --sfb-page: #eef1f6;
          --sfb-card: #ffffff;
          --sfb-ink: #1e293b;
          --sfb-muted: #64748b;
          --sfb-line: #e8edf5;
          --sfb-soft: #f4f7fb;
          --sfb-well: #ffffff;
          --sfb-brand: #2547d0;
          --sfb-brand-soft: #e8edff;
          --sfb-amber: #b45309;
          --sfb-amber-soft: #fff7ed;
          --sfb-amber-line: #f0c48a;
          --sfb-focus: #2547d0;
          --sfb-danger: #e11d48;
          --sfb-danger-soft: #fff1f2;
        }
        @media (prefers-color-scheme: dark) {
          .sfb {
            --sfb-page: #0b1220;
            --sfb-card: #141b2e;
            --sfb-ink: #eef2ff;
            --sfb-muted: #94a3b8;
            --sfb-line: #2a3550;
            --sfb-soft: #1a2238;
            --sfb-well: #10182b;
            --sfb-brand: #7c97ff;
            --sfb-brand-soft: #1f2b57;
            --sfb-amber: #fbbf5c;
            --sfb-amber-soft: #33270f;
            --sfb-amber-line: #a67c2a;
            --sfb-focus: #7c97ff;
            --sfb-danger: #fb7185;
            --sfb-danger-soft: rgba(251, 113, 133, 0.12);
          }
        }
        @keyframes sfb-in {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .sfb-chip-in { animation: sfb-in 220ms ease-out both; }
        }
        .sfb :focus-visible {
          outline: 2px solid var(--sfb-focus);
          outline-offset: 2px;
        }
        .sfb-card:hover {
          border-color: color-mix(in srgb, var(--sfb-brand) 28%, var(--sfb-line));
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
        }
        .sfb-card-suggested:hover {
          border-color: color-mix(in srgb, var(--sfb-amber) 45%, var(--sfb-amber-line));
        }
        .sfb-value-in {
          border-color: color-mix(in srgb, var(--sfb-brand) 28%, var(--sfb-line));
          background: var(--sfb-brand-soft);
          color: var(--sfb-ink);
        }
        .sfb-value-suggested {
          border-color: var(--sfb-amber-line);
          background: var(--sfb-well);
          color: var(--sfb-ink);
        }
        .sfb-value-empty {
          border-color: var(--sfb-line);
          background: var(--sfb-well);
          color: var(--sfb-muted);
          font-weight: 500;
          font-style: italic;
        }
        @media (prefers-reduced-motion: reduce) {
          .sfb-card:hover, .sfb-card-suggested:hover { box-shadow: none; }
        }
      `}</style>

      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-[19px] font-bold leading-tight tracking-tight text-[var(--sfb-ink)]">
              Schema field builder
            </h2>
            <p className="mt-1.5 mb-0 text-[13px] leading-snug text-[var(--sfb-muted)]">
              Fields extracted from{" "}
              <strong className="font-semibold text-[var(--sfb-ink)]">{fileName}</strong>
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <span className="rounded-full bg-[var(--sfb-brand-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sfb-brand)]">
              {inSchema.length} in schema
            </span>
            {suggested.length > 0 ? (
              <span className="rounded-full bg-[var(--sfb-amber-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sfb-amber)]">
                {suggested.length} suggested
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="relative mb-5">
        <label className="sr-only" htmlFor={searchId}>
          Search fields
        </label>
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[var(--sfb-muted)]">
          <SearchIcon />
        </span>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search fields"
          className="w-full rounded-2xl border border-[var(--sfb-line)] bg-[var(--sfb-soft)] py-3 pr-3.5 pl-10 text-[14px] text-[var(--sfb-ink)] placeholder:text-[var(--sfb-muted)]"
        />
      </div>

      {suggested.length > 0 && (
        <section className="mb-6" aria-labelledby="sfb-suggested-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h3
                id="sfb-suggested-heading"
                className="m-0 text-[13px] font-semibold tracking-tight text-[var(--sfb-ink)]"
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
              className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-semibold text-[var(--sfb-amber)] hover:bg-[var(--sfb-amber-soft)]"
            >
              Add all
            </button>
          </div>

          {visibleSuggested.length === 0 ? (
            <p className="m-0 rounded-2xl bg-[var(--sfb-soft)] px-4 py-5 text-center text-[13px] text-[var(--sfb-muted)]">
              No suggestions match.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {visibleSuggested.map((field, index) => (
                <FieldCard key={field.id} field={field} index={index} variant="suggested" />
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="sfb-schema-heading">
        <div className="mb-3 flex items-center gap-2">
          <h3
            id="sfb-schema-heading"
            className="m-0 text-[13px] font-semibold tracking-tight text-[var(--sfb-ink)]"
          >
            In your schema
          </h3>
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--sfb-soft)] px-1.5 text-[11px] font-semibold text-[var(--sfb-muted)]"
            aria-label={`${inSchema.length} in schema`}
          >
            {inSchema.length}
          </span>
        </div>

        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {visibleInSchema.map((field, index) => (
            <FieldCard key={field.id} field={field} index={index} variant="in" />
          ))}

          <li>
            {creating ? (
              <form
                onSubmit={onCustomSubmit}
                className="rounded-2xl border border-dashed border-[var(--sfb-brand)] bg-[var(--sfb-brand-soft)]/40 p-3.5"
              >
                <label className="sr-only" htmlFor={customId}>
                  Field name
                </label>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-[14px] font-bold text-[var(--sfb-brand)] dark:bg-[#10182b]"
                    aria-hidden="true"
                  >
                    +
                  </span>
                  <input
                    id={customId}
                    ref={customInputRef}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={onCustomKeyDown}
                    placeholder="Field name"
                    className="min-w-0 flex-1 rounded-xl border border-[var(--sfb-line)] bg-[var(--sfb-well)] px-3 py-2 text-[14px] font-semibold text-[var(--sfb-ink)] placeholder:font-normal placeholder:text-[var(--sfb-muted)]"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelCreate}
                    aria-label="Cancel custom field"
                    className="rounded-xl px-3 py-2 text-[13px] font-semibold text-[var(--sfb-muted)] hover:bg-white/70"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-xl bg-[var(--sfb-brand)] px-3.5 py-2 text-[13px] font-semibold text-white"
                  >
                    <PlusIcon />
                    Add
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--sfb-line)] bg-transparent px-4 py-4 text-[13px] font-semibold text-[var(--sfb-muted)] transition-colors hover:border-[var(--sfb-brand)] hover:bg-[var(--sfb-brand-soft)] hover:text-[var(--sfb-brand)]"
              >
                <PlusIcon />
                Add custom field
              </button>
            )}
          </li>
        </ul>

        {needle && visibleInSchema.length === 0 && inSchema.length > 0 ? (
          <p className="mt-3 mb-0 text-[13px] text-[var(--sfb-muted)]">No schema fields match.</p>
        ) : null}
      </section>
    </section>
  );
};

export default SchemaFieldBuilder;
