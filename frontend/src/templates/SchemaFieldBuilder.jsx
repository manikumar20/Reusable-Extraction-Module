import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";

/**
 * @typedef {{ id: string; name: string; description: string; status: "in_schema" | "suggested" }} SchemaField
 */

/**
 * Review AI-extracted fields before saving them to the schema.
 *
 * @param {{
 *   fileName: string;
 *   fields: SchemaField[];
 *   onAdd: (id: string) => void;
 *   onAddAll: (ids: string[]) => void;
 *   onRemove: (id: string) => void;
 *   onCreate: (name: string) => void;
 * }} props
 */
export function SchemaFieldBuilder({
  fileName,
  fields,
  onAdd,
  onAddAll,
  onRemove,
  onCreate,
}) {
  const [items, setItems] = useState(() => fields.map(cloneField));
  const [query, setQuery] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const customInputRef = useRef(null);
  const searchId = useId();

  useEffect(() => {
    setItems(fields.map(cloneField));
  }, [fields]);

  useEffect(() => {
    if (addingCustom) customInputRef.current?.focus();
  }, [addingCustom]);

  const needle = query.trim().toLowerCase();
  const matches = (field) =>
    !needle ||
    field.name.toLowerCase().includes(needle) ||
    field.description.toLowerCase().includes(needle);

  const suggested = useMemo(
    () => items.filter((field) => field.status === "suggested"),
    [items],
  );
  const inSchema = useMemo(
    () => items.filter((field) => field.status === "in_schema"),
    [items],
  );
  const visibleSuggested = suggested.filter(matches);
  const visibleInSchema = inSchema.filter(matches);

  const addSuggested = (id) => {
    setItems((current) =>
      current.map((field) =>
        field.id === id && field.status === "suggested"
          ? { ...field, status: "in_schema" }
          : field,
      ),
    );
    onAdd?.(id);
  };

  const addAllSuggested = () => {
    const ids = suggested.map((field) => field.id);
    if (!ids.length) return;
    setItems((current) =>
      current.map((field) =>
        field.status === "suggested" ? { ...field, status: "in_schema" } : field,
      ),
    );
    onAddAll?.(ids);
  };

  const removeField = (id) => {
    setItems((current) => current.filter((field) => field.id !== id));
    onRemove?.(id);
  };

  const submitCustom = () => {
    const name = customName.trim();
    if (!name) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `custom-${Date.now()}`;
    setItems((current) => [
      ...current,
      {
        id,
        name,
        description: "Custom field you added.",
        status: "in_schema",
      },
    ]);
    onCreate?.(name);
    setCustomName("");
    setAddingCustom(false);
  };

  const cancelCustom = () => {
    setCustomName("");
    setAddingCustom(false);
  };

  return (
    <section
      className="sfb mx-auto w-full max-w-[680px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none"
      style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}
      aria-labelledby={`${searchId}-title`}
    >
      <header className="mb-5">
        <h2
          id={`${searchId}-title`}
          className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50"
        >
          Schema field builder
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Fields extracted from <span className="font-medium text-slate-700 dark:text-slate-200">{fileName}</span>
        </p>
      </header>

      <div className="relative mb-6">
        <label htmlFor={searchId} className="sr-only">
          Search fields
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          aria-hidden="true"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search fields"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-3 pl-10 text-sm text-slate-900 outline-none transition-[box-shadow,border-color] placeholder:text-slate-400 focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-blue-400"
        />
      </div>

      {suggested.length > 0 && (
        <section className="mb-6" aria-labelledby={`${searchId}-suggested`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3
                id={`${searchId}-suggested`}
                className="text-sm font-semibold text-slate-800 dark:text-slate-100"
              >
                Suggested fields
              </h3>
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                {suggested.length}
              </span>
            </div>
            <button
              type="button"
              onClick={addAllSuggested}
              className="rounded-md px-1.5 py-1 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 motion-reduce:transition-none dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-100"
            >
              Add all
            </button>
          </div>

          {visibleSuggested.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
              No suggested fields match your search.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-2.5">
              {visibleSuggested.map((field) => (
                <SuggestedChip
                  key={field.id}
                  field={field}
                  onAdd={() => addSuggested(field.id)}
                  onDismiss={() => removeField(field.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby={`${searchId}-schema`}>
        <div className="mb-3 flex items-center gap-2">
          <h3
            id={`${searchId}-schema`}
            className="text-sm font-semibold text-slate-800 dark:text-slate-100"
          >
            In your schema
          </h3>
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">
            {inSchema.length}
          </span>
        </div>

        {visibleInSchema.length === 0 && !addingCustom && needle ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
            No schema fields match your search.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-2.5">
            {visibleInSchema.map((field) => (
              <SchemaChip
                key={field.id}
                field={field}
                onRemove={() => removeField(field.id)}
              />
            ))}

            {addingCustom ? (
              <div className="flex min-h-[4.5rem] items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 p-2.5 dark:border-blue-500/40 dark:bg-blue-500/10">
                <input
                  ref={customInputRef}
                  type="text"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCustom();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelCustom();
                    }
                  }}
                  placeholder="Field name"
                  aria-label="Custom field name"
                  className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-blue-500/30 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={submitCustom}
                  className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 motion-reduce:transition-none dark:bg-blue-500 dark:hover:bg-blue-400"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={cancelCustom}
                  aria-label="Cancel custom field"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 motion-reduce:transition-none dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingCustom(true)}
                className="flex min-h-[4.5rem] items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-transparent px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-400 dark:hover:border-blue-400/50 dark:hover:bg-blue-500/10 dark:hover:text-blue-200"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add custom field
              </button>
            )}
          </div>
        )}
      </section>
    </section>
  );
}

function SchemaChip({ field, onRemove }) {
  return (
    <div className="flex min-h-[4.5rem] items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-100">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-blue-400 dark:text-blue-950">
        <Check className="size-3 stroke-[3]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{field.name}</p>
        <p className="mt-0.5 truncate text-xs text-blue-700/80 dark:text-blue-200/80">
          {field.description}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${field.name}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 motion-reduce:transition-none dark:text-blue-300 dark:hover:bg-blue-500/20 dark:hover:text-blue-50"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function SuggestedChip({ field, onAdd, onDismiss }) {
  return (
    <div className="flex min-h-[4.5rem] items-start gap-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-amber-900 dark:text-amber-100">
          {field.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-amber-800/80 dark:text-amber-200/80">
          {field.description}
        </p>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add ${field.name}`}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-200/80 px-2.5 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 motion-reduce:transition-none dark:bg-amber-500/30 dark:text-amber-100 dark:hover:bg-amber-500/45"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss ${field.name}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 motion-reduce:transition-none dark:text-amber-300 dark:hover:bg-amber-500/20 dark:hover:text-amber-50"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function cloneField(field) {
  return {
    id: field.id,
    name: field.name,
    description: field.description,
    status: field.status,
  };
}

export default SchemaFieldBuilder;
