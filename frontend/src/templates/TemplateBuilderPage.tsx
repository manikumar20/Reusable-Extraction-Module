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
import {
  fieldsFromCatalogSeed,
  fieldsFromSuggestions,
  newTemplateField,
  uniqueFieldsByName,
  type SourceDocument,
} from "./matching";
import "./templates.css";
import { type TemplateCategory, type TemplateField } from "./types";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

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

export const TemplateBuilderPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = location.state as { sample?: File; files?: File[]; name?: string } | null;
  const [name, setName] = useState(incoming?.name?.trim() || "Untitled template");
  const [category, setCategory] = useState<TemplateCategory>("Finance");
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dismissed = useRef(new Set<string>());
  const started = useRef(false);
  const readingIds = useRef(new Set<string>());
  const documentsRef = useRef<SourceDocument[]>([]);
  const catalog = useRef<CatalogField[]>([]);
  const headerCatalogKeys = useRef(new Set<string>());
  /** Fields loaded from an existing template (kept when a sample has no suggestions yet). */
  const seedFields = useRef<TemplateField[]>([]);
  /** Left panel shows fields for the selected file only (not a merge of every upload). */
  const rebuildForFile = (docs: SourceDocument[], fileId: string | null) => {
    const focus = docs.find((document) => document.id === fileId) ?? null;
    setFields((current) => {
      // Customs the user accepted or added manually stay across file switches.
      const keptCustoms = current.filter(
        (field) =>
          !field.suggested &&
          !field.catalogKey &&
          !dismissed.current.has(field.id),
      );
      if (!focus?.suggestions) {
        const seed = seedFields.current.filter(
          (field) =>
            !dismissed.current.has(field.id) &&
            !(field.catalogKey && dismissed.current.has(field.catalogKey)),
        );
        const seedIds = new Set(seed.map((field) => field.id));
        const fallback = uniqueFieldsByName([
          ...seed,
          ...keptCustoms.filter((field) => !seedIds.has(field.id)),
        ]);
        setSelectedId((currentId) =>
          currentId && fallback.some((field) => field.id === currentId)
            ? currentId
            : (fallback[0]?.id ?? null),
        );
        return fallback;
      }
      const priorMatched = new Map(
        current
          .filter((field) => field.catalogKey)
          .map((field) => [field.catalogKey as string, field]),
      );
      const next = fieldsFromSuggestions(
        [focus],
        dismissed.current,
        keptCustoms,
        catalog.current,
        headerCatalogKeys.current,
      );
      const merged = uniqueFieldsByName(
        next.map((field) => {
          if (!field.catalogKey) return field;
          const existing = priorMatched.get(field.catalogKey);
          if (!existing) return field;
          return {
            ...field,
            sampleBox: existing.sampleBox,
            sampleValue: field.sampleValue ?? existing.sampleValue,
            name: existing.name || field.name,
          };
        }),
      );
      setSelectedId((currentId) =>
        currentId && merged.some((field) => field.id === currentId) ? currentId : (merged[0]?.id ?? null),
      );
      return merged;
    });
  };

  /** Persist union of every sample's matched fields + accepted customs + seed fields. */
  const fieldsForSave = (current: TemplateField[]) => {
    const customs = current.filter((field) => !field.suggested && !field.catalogKey);
    const edits = new Map(
      current
        .filter((field) => field.catalogKey && !field.suggested)
        .map((field) => [field.catalogKey as string, field]),
    );
    const fromAll = fieldsFromSuggestions(
      documentsRef.current,
      dismissed.current,
      [],
      catalog.current,
      headerCatalogKeys.current,
    ).filter((field) => !field.suggested && field.catalogKey);
    const byKey = new Map<string, TemplateField>();
    for (const field of fromAll) {
      const key = field.catalogKey as string;
      if (dismissed.current.has(key)) continue;
      const edited = edits.get(key);
      byKey.set(key, edited ? { ...field, ...edited, catalogKey: key } : field);
    }
    for (const [key, field] of edits) {
      if (!byKey.has(key) && !dismissed.current.has(key)) byKey.set(key, field);
    }
    for (const field of seedFields.current) {
      if (field.catalogKey) {
        if (dismissed.current.has(field.catalogKey) || byKey.has(field.catalogKey)) continue;
        byKey.set(field.catalogKey, field);
      }
    }
    const customIds = new Set(customs.map((field) => field.id));
    const seedCustoms = seedFields.current.filter(
      (field) =>
        !field.catalogKey &&
        !dismissed.current.has(field.id) &&
        !customIds.has(field.id),
    );
    return uniqueFieldsByName([...byKey.values(), ...customs, ...seedCustoms]);
  };

  const extractFile = async (document: SourceDocument) => {
    if (readingIds.current.has(document.id)) return;
    readingIds.current.add(document.id);

    // Ensure status is reading
    setDocuments((current) =>
      current.map((item) =>
        item.id === document.id
          ? { ...item, status: "reading" as const, message: undefined }
          : item,
      ),
    );

    try {
      const suggestions = await suggestFields(document.file);
      setDocuments((current) =>
        current.map((item) =>
          item.id === document.id
            ? { ...item, status: "ready" as const, suggestions, message: undefined }
            : item,
        ),
      );
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
      readingIds.current.delete(document.id);
    }
  };

  const addFiles = (incomingFiles: File[]) => {
    setError("");
    const currentDocs = documentsRef.current;
    const known = new Set(currentDocs.map((document) => fileKey(document.file)));
    const additions: SourceDocument[] = [];

    for (const file of incomingFiles) {
      const key = fileKey(file);
      const existing = currentDocs.find((d) => fileKey(d.file) === key);
      if (existing) {
        // Re-extract file if already present
        void extractFile(existing);
        continue;
      }
      known.add(key);
      const problem = rejectReason(file);
      additions.push({
        id: crypto.randomUUID(),
        file,
        status: problem ? "error" : "reading",
        message: problem || undefined,
      });
    }

    if (!additions.length) return;

    documentsRef.current = [...documentsRef.current, ...additions];
    setDocuments((current) => [...current, ...additions]);
    setActiveId((currentId) => currentId ?? additions[0]?.id ?? null);

    // Launch extraction immediately for every valid readable file!
    const valid = additions.filter((doc) => doc.status === "reading");
    valid.forEach((doc) => {
      void extractFile(doc);
    });
  };

  useEffect(() => {
    documentsRef.current = documents;
    const focusId = activeId ?? documents[0]?.id ?? null;
    const focus = documents.find((document) => document.id === focusId);
    if (focus?.suggestions || documents.some((document) => document.suggestions)) {
      rebuildForFile(documents, focusId);
    }
  }, [documents, activeId]);

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
    document.title = "Template Studio · ExtractIQ";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listCatalogFields()
      .then((fieldsFromCatalog) => {
        if (cancelled) return;
        catalog.current = fieldsFromCatalog.all;
        headerCatalogKeys.current = new Set(fieldsFromCatalog.header.map((field) => field.key));
        // New templates start with catalogue defaults already in "In your schema".
        if (!id && seedFields.current.length === 0) {
          const seeded = fieldsFromCatalogSeed(fieldsFromCatalog.header, fieldsFromCatalog.lines, {
            defaultsOnly: true,
          });
          seedFields.current = seeded;
          setFields(seeded);
          setSelectedId(seeded[0]?.id ?? null);
        }
        // Re-apply suggestions once the catalogue arrives so matched DB fields land in schema.
        if (documentsRef.current.some((document) => document.status === "ready" && document.suggestions)) {
          rebuildForFile(documentsRef.current, activeId ?? documentsRef.current[0]?.id ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep left-panel fields in sync when a sample finishes extracting.
  useEffect(() => {
    documentsRef.current = documents;
    const focus = documents.find((document) => document.id === activeId);
    if (focus?.status === "ready" && focus.suggestions && catalog.current.length) {
      rebuildForFile(documents, activeId);
    }
  }, [documents, activeId]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const template = await getTemplate(id);
        if (cancelled) return;
        setName(template.name);
        setCategory(template.category);
        seedFields.current = template.fields;
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

  const persist = async () => {
    const toSave = fieldsForSave(fields);
    const problem = (() => {
      const named = toSave.map((field) => field.name.trim()).filter(Boolean);
      if (!name.trim()) return "Enter a template name.";
      if (!named.length) return "Add at least one field.";
      if (new Set(named.map((item) => item.toLowerCase())).size !== named.length) {
        return "Field names must be unique.";
      }
      return "";
    })();
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
        fields: toSave.map((field) => ({
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

  const addField = (name?: string) => {
    const field = newTemplateField({
      name: name?.trim() || "New field",
      hint: name?.trim() ? "Custom field you added." : undefined,
      suggested: false,
    });
    setFields((current) => [...current, field]);
    setSelectedId(field.id);
  };

  const acceptSuggested = (fieldId: string) => {
    setFields((current) =>
      current.map((field) => {
        if (field.id !== fieldId || !field.suggested) return field;
        const catalogField = catalog.current.find(
          (entry) =>
            entry.key === field.id ||
            entry.label.toLowerCase() === field.name.trim().toLowerCase(),
        );
        return {
          ...field,
          suggested: false,
          catalogKey: catalogField?.key,
          name: catalogField?.label || field.name,
          hint: catalogField?.description || field.hint,
          type: catalogField ? field.type : field.type,
          level: catalogField
            ? headerCatalogKeys.current.has(catalogField.key)
              ? "header"
              : "line"
            : field.level,
        };
      }),
    );
  };

  const acceptAllSuggested = () => {
    setFields((current) =>
      current.map((field) => {
        if (!field.suggested) return field;
        const catalogField = catalog.current.find(
          (entry) =>
            entry.key === field.id ||
            entry.label.toLowerCase() === field.name.trim().toLowerCase(),
        );
        return {
          ...field,
          suggested: false,
          catalogKey: catalogField?.key,
          name: catalogField?.label || field.name,
          hint: catalogField?.description || field.hint,
          level: catalogField
            ? headerCatalogKeys.current.has(catalogField.key)
              ? "header"
              : "line"
            : field.level,
        };
      }),
    );
  };

  const readingCount = documents.filter((d) => d.status === "reading").length;
  const isExtracting = readingCount > 0;

  return (
    <section className="tm tm-builder tm-studio">
      <header className="tm-builder-head">
        <div className="tm-builder-title">
          <nav className="tm-crumbs" aria-label="Breadcrumb">
            <button type="button" className="tm-crumb" onClick={() => navigate("/templates")}>
              Templates
            </button>
            <span className="tm-crumb-sep" aria-hidden="true">
              ›
            </span>
            <input
              className="tm-input tm-name"
              aria-label="Template name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </nav>
          <span className="tm-badge tm-badge-active">Draft</span>
          {isExtracting && (
            <span className="tm-extracting-pill" title="Processing files simultaneously">
              <span className="tm-extract-spinner sm" aria-hidden="true" />
              Extracting {readingCount} file{readingCount > 1 ? "s" : ""} simultaneously…
            </span>
          )}
        </div>
        <div className="tm-builder-actions">
          <button type="button" className="tm-btn tm-btn-primary has-plus" onClick={() => addField()}>
            <span className="tm-btn-plus" aria-hidden="true">+</span>
            Add Field
          </button>
          <button type="button" className="tm-btn tm-btn-primary" disabled={saving} onClick={() => void persist()}>
            {saving ? "Saving…" : "Save & Publish"}
          </button>
        </div>
      </header>
      {error && <p className="tm-error">{error}</p>}
      <div className="tm-layout">
        <FieldList
          fields={fields}
          selectedId={selectedId}
          activeFileName={documents.find((document) => document.id === activeId)?.file.name}
          isExtracting={Boolean(
            documents.find((document) => document.id === activeId)?.status === "reading",
          )}
          onSelect={setSelectedId}
          onAccept={acceptSuggested}
          onAcceptAll={acceptAllSuggested}
          onReject={(fieldId) => {
            const removed = fields.find((field) => field.id === fieldId);
            if (removed?.catalogKey) dismissed.current.add(removed.catalogKey);
            else dismissed.current.add(fieldId);
            const next = fields.filter((field) => field.id !== fieldId);
            setFields(next);
            setSelectedId(next[0]?.id ?? null);
          }}
          onAdd={addField}
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
          onAdd={addFiles}
          onSelect={setActiveId}
          onRemove={(documentId) => {
            setDocuments((current) => {
              const next = current.filter((document) => document.id !== documentId);
              setActiveId((currentId) => (currentId === documentId ? (next[0]?.id ?? null) : currentId));
              return next;
            });
          }}
        />
      </div>
    </section>
  );
};
