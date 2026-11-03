import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { extensionOf, FALLBACK_ACCEPT } from "../format";
import type { CatalogField } from "../types";
import {
  fetchTemplateDocumentFile,
  getTemplate,
  listCatalogFields,
  listTemplateDocuments,
  saveTemplate,
  saveTemplateDocuments,
  suggestFields,
} from "./api";
import { DocumentStage } from "./DocumentStage";
import { FieldList } from "./FieldList";
import type { SourceDocument } from "./matching";
import "./templates.css";
import {
  dataTypeToFieldType,
  type FieldSuggestions,
  type TemplateCategory,
  type TemplateField,
} from "./types";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

const newField = (partial?: Partial<TemplateField>): TemplateField => ({
  id: partial?.id || crypto.randomUUID(),
  name: partial?.name || "New field",
  type: partial?.type || "text",
  required: partial?.required ?? false,
  hint: partial?.hint,
  format: partial?.format,
  validation: partial?.validation,
  sampleBox: partial?.sampleBox,
  catalogKey: partial?.catalogKey,
  level: partial?.level ?? "line",
  suggested: partial?.suggested,
  sampleValue: partial?.sampleValue,
});

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const rejectReason = (file: File) => {
  const extension = extensionOf(file.name);
  if (!FALLBACK_ACCEPT.includes(extension)) {
    return "Use a PDF, Word, Excel, text, or image file.";
  }
  const limit = (IMAGE_EXTENSIONS.has(extension) ? 5 : 25) * 1024 * 1024;
  if (file.size > limit) {
    return IMAGE_EXTENSIONS.has(extension) ? "Images must be 5 MB or smaller." : "File is larger than 25 MB.";
  }
  return "";
};

/**
 * Build the template field list from sample suggestions.
 * - matched: only keys that exist in LINE_FIELDS (fields.ts)
 * - suggested: values found in the file that are NOT in the catalogue (accept or reject)
 * - keptAccepted: customs the user already accepted (no catalogue key)
 */
const fieldsFromSuggestions = (
  docs: SourceDocument[],
  dismissed: Set<string>,
  keptAccepted: TemplateField[],
  catalog: CatalogField[],
) => {
  const byKey = new Map(catalog.map((field) => [field.key, field]));
  const acceptedIds = new Set(keptAccepted.map((field) => field.id));
  const ready = docs.filter((document) => document.status === "ready" && document.suggestions);
  const matchedVotes = new Map<
    string,
    { label: string; type: TemplateField["type"]; hits: number; sampleValue?: string }
  >();
  const suggestedVotes = new Map<
    string,
    { label: string; type: TemplateField["type"]; description: string; hits: number; sampleValue?: string }
  >();

  for (const document of ready) {
    const suggestions = document.suggestions as FieldSuggestions;
    const seenMatched = new Set<string>();
    for (const hit of suggestions.matched) {
      // Only real line-catalogue keys from fields.ts
      if (!byKey.has(hit.key) || dismissed.has(hit.key) || seenMatched.has(hit.key)) continue;
      seenMatched.add(hit.key);
      const catalogField = byKey.get(hit.key)!;
      const row = matchedVotes.get(hit.key) ?? {
        label: catalogField.label,
        type: dataTypeToFieldType(catalogField.dataType),
        hits: 0,
        sampleValue: hit.sampleValue,
      };
      row.hits += 1;
      row.label = catalogField.label;
      if (hit.sampleValue) row.sampleValue = hit.sampleValue;
      matchedVotes.set(hit.key, row);
    }
    const seenSuggested = new Set<string>();
    for (const hit of suggestions.suggested) {
      // Never treat a catalogue key as a custom suggestion
      if (byKey.has(hit.key) || dismissed.has(hit.key) || acceptedIds.has(hit.key) || seenSuggested.has(hit.key)) {
        continue;
      }
      seenSuggested.add(hit.key);
      const row = suggestedVotes.get(hit.key) ?? {
        label: hit.label,
        type: dataTypeToFieldType(hit.dataType),
        description: hit.description,
        hits: 0,
        sampleValue: hit.sampleValue,
      };
      row.hits += 1;
      row.label = hit.label;
      row.description = hit.description;
      if (hit.sampleValue) row.sampleValue = hit.sampleValue;
      suggestedVotes.set(hit.key, row);
    }
  }

  const docCount = Math.max(ready.length, 1);
  const matched = [...matchedVotes.entries()]
    .filter(([, row]) => row.hits >= Math.ceil(docCount / 2))
    .map(([key, row]) =>
      newField({
        id: `matched:${key}`,
        name: row.label,
        type: row.type,
        catalogKey: key,
        level: "line",
        sampleValue: row.sampleValue,
        required: false,
        suggested: false,
      }),
    );
  const suggested = [...suggestedVotes.entries()]
    .filter(([, row]) => row.hits >= Math.ceil(docCount / 2))
    .map(([key, row]) =>
      newField({
        id: key,
        name: row.label,
        type: row.type,
        level: "line",
        suggested: true,
        sampleValue: row.sampleValue,
        hint: row.description,
      }),
    );

  return [...matched, ...suggested, ...keptAccepted];
};

export const TemplateBuilderPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = location.state as { sample?: File; files?: File[] } | null;
  const [name, setName] = useState("Untitled template");
  const [category, setCategory] = useState<TemplateCategory>("Finance");
  const [version, setVersion] = useState(1);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dismissed = useRef(new Set<string>());
  const started = useRef(false);
  const readingIds = useRef(new Set<string>());
  const queue = useRef<SourceDocument[]>([]);
  const activeReads = useRef(0);
  const catalog = useRef<CatalogField[]>([]);
  const selected = fields.find((field) => field.id === selectedId) ?? null;

  const rebuild = (docs: SourceDocument[]) => {
    setFields((current) => {
      // Keep customs the user accepted or added manually (not pending suggestions).
      const keptAccepted = current.filter(
        (field) => !field.catalogKey && !field.suggested && !dismissed.current.has(field.id),
      );
      const next = fieldsFromSuggestions(docs, dismissed.current, keptAccepted, catalog.current);
      const priorMatched = new Map(
        current
          .filter((field) => field.catalogKey)
          .map((field) => [field.catalogKey as string, field]),
      );
      const merged = next.map((field) => {
        if (!field.catalogKey) return field;
        const existing = priorMatched.get(field.catalogKey);
        if (!existing) return field;
        return {
          ...field,
          sampleBox: existing.sampleBox,
          sampleValue: field.sampleValue ?? existing.sampleValue,
          name: existing.name || field.name,
        };
      });
      setSelectedId((currentId) =>
        currentId && merged.some((field) => field.id === currentId) ? currentId : (merged[0]?.id ?? null),
      );
      return merged;
    });
  };

  const pumpQueue = () => {
    while (activeReads.current < 3 && queue.current.length) {
      const document = queue.current.shift();
      if (!document || readingIds.current.has(document.id)) continue;
      readingIds.current.add(document.id);
      activeReads.current += 1;
      void (async () => {
        try {
          const suggestions = await suggestFields(document.file);
          setDocuments((current) => {
            const next = current.map((item) =>
              item.id === document.id
                ? { ...item, status: "ready" as const, suggestions, message: undefined }
                : item,
            );
            rebuild(next);
            return next;
          });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "This document could not be read.";
          setDocuments((current) =>
            current.map((item) =>
              item.id === document.id
                ? { ...item, status: "error" as const, message, suggestions: undefined }
                : item,
            ),
          );
        } finally {
          activeReads.current -= 1;
          pumpQueue();
        }
      })();
    }
  };

  const addFiles = (incomingFiles: File[]) => {
    setError("");
    const created: SourceDocument[] = [];
    setDocuments((current) => {
      const known = new Set(current.map((document) => fileKey(document.file)));
      const additions: SourceDocument[] = [];
      for (const file of incomingFiles) {
        const key = fileKey(file);
        if (known.has(key)) continue;
        known.add(key);
        const problem = rejectReason(file);
        additions.push({
          id: crypto.randomUUID(),
          file,
          status: problem ? "error" : "reading",
          message: problem || undefined,
        });
      }
      created.push(...additions);
      if (!additions.length) return current;
      setActiveId((currentId) => currentId ?? additions[0]?.id ?? null);
      return [...current, ...additions];
    });
    queue.current.push(...created.filter((document) => document.status === "reading"));
    pumpQueue();
  };

  /** Show saved sample files without re-running Claude suggest. */
  const showStoredFiles = (files: File[]) => {
    if (!files.length) return;
    setDocuments((current) => {
      const known = new Set(current.map((document) => fileKey(document.file)));
      const additions: SourceDocument[] = files
        .filter((file) => !known.has(fileKey(file)))
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          status: "ready" as const,
        }));
      if (!additions.length) return current;
      setActiveId((currentId) => currentId ?? additions[0]?.id ?? null);
      return [...current, ...additions];
    });
  };

  useEffect(() => {
    const previous = document.title;
    document.title = "Template Builder";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listCatalogFields()
      .then((fieldsFromCatalog) => {
        if (!cancelled) catalog.current = fieldsFromCatalog;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const template = await getTemplate(id);
        if (cancelled) return;
        setName(template.name);
        setCategory(template.category);
        setVersion(template.version);
        setFields(template.fields);
        setSelectedId(template.fields[0]?.id ?? null);

        const stored = await listTemplateDocuments(id);
        if (cancelled || !stored.length) return;
        const files = await Promise.all(
          stored.map((doc) => fetchTemplateDocumentFile(id, doc.id, doc.fileName)),
        );
        if (cancelled) return;
        showStoredFiles(files);
      } catch (reason: unknown) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Template could not be loaded.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (started.current) return;
    const files = incoming?.files ?? (incoming?.sample ? [incoming.sample] : []);
    if (!files.length) return;
    started.current = true;
    addFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateField = (next: TemplateField) => {
    setFields((current) => current.map((field) => (field.id === next.id ? next : field)));
  };

  const validate = () => {
    const named = fields.map((field) => field.name.trim()).filter(Boolean);
    if (!name.trim()) return "Enter a template name.";
    if (!named.length) return "Add at least one field.";
    if (new Set(named.map((item) => item.toLowerCase())).size !== named.length) {
      return "Field names must be unique.";
    }
    return "";
  };

  const persist = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await saveTemplate({
        id,
        name: name.trim(),
        category,
        fields: fields
          .filter((field) => !field.suggested)
          .map((field) => ({
            ...field,
            name: field.name.trim(),
            level: field.level ?? "line",
            suggested: undefined,
            sampleValue: undefined,
          })),
      });
      await saveTemplateDocuments(
        saved.id,
        documents.map((document) => document.file),
      );
      navigate("/templates", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Template could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="tm tm-builder">
      <header className="tm-builder-head">
        <div className="tm-builder-title">
          <input
            className="tm-input tm-name"
            aria-label="Template name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="tm-version">· v{version}</span>
          <span className="tm-badge">Draft</span>
        </div>
        <div className="tm-builder-actions">
          <button type="button" className="tm-btn tm-btn-primary" disabled={saving} onClick={() => void persist()}>
            {saving ? "Saving…" : "Save template"}
          </button>
        </div>
      </header>
      {error && <p className="tm-error">{error}</p>}
      <div className="tm-layout">
        <FieldList
          fields={fields}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReorder={setFields}
          onAccept={(fieldId) =>
            setFields((current) =>
              current.map((field) =>
                field.id === fieldId
                  ? { ...field, suggested: false, catalogKey: undefined }
                  : field,
              ),
            )
          }
          onReject={(fieldId) => {
            const removed = fields.find((field) => field.id === fieldId);
            if (removed?.catalogKey) dismissed.current.add(removed.catalogKey);
            else dismissed.current.add(fieldId);
            const next = fields.filter((field) => field.id !== fieldId);
            setFields(next);
            setSelectedId(next[0]?.id ?? null);
          }}
          onAdd={() => {
            const field = newField();
            setFields((current) => [...current, field]);
            setSelectedId(field.id);
          }}
          onDelete={(fieldId) => {
            const removed = fields.find((field) => field.id === fieldId);
            if (removed?.catalogKey) dismissed.current.add(removed.catalogKey);
            else dismissed.current.add(fieldId);
            const next = fields.filter((field) => field.id !== fieldId);
            setFields(next);
            setSelectedId(next[0]?.id ?? null);
          }}
        />
        <DocumentStage
          documents={documents}
          activeId={activeId}
          fields={fields}
          selectedFieldId={selectedId}
          onAdd={addFiles}
          onSelect={setActiveId}
          onRemove={(documentId) => {
            setDocuments((current) => {
              const next = current.filter((document) => document.id !== documentId);
              setActiveId((currentId) => (currentId === documentId ? (next[0]?.id ?? null) : currentId));
              rebuild(next);
              return next;
            });
          }}
          onMap={(box) => {
            if (!selected) return;
            updateField({ ...selected, sampleBox: box });
          }}
        />
      </div>
    </section>
  );
};
