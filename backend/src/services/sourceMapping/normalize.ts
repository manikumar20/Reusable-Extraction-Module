/** Collapse whitespace and case for fuzzy value matching. */
export const normalizeValue = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Compact form used when spacing or punctuation differs. */
export const compactValue = (value: string) =>
  normalizeValue(value).replace(/[^a-z0-9]+/g, "");

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Date format variants so "2024-01-05", "05/01/2024", and "5 Jan 2024" can match. */
export const dateVariants = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);
  const iso = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const year = iso[1];
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    variants.add(`${pad2(day)}/${pad2(month)}/${year}`);
    variants.add(`${pad2(month)}/${pad2(day)}/${year}`);
    variants.add(`${day}/${month}/${year}`);
    variants.add(`${month}/${day}/${year}`);
    variants.add(`${year}/${pad2(month)}/${pad2(day)}`);
  }
  const slash = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    variants.add(`${year}-${pad2(a)}-${pad2(b)}`);
    variants.add(`${year}-${pad2(b)}-${pad2(a)}`);
    variants.add(`${pad2(a)}/${pad2(b)}/${year}`);
    variants.add(`${pad2(b)}/${pad2(a)}/${year}`);
  }
  return [...variants];
};

export const candidateValues = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[]") return [];
  const out = new Set<string>([trimmed, ...dateVariants(trimmed)]);
  // Currency / numeric soft variants
  const stripped = trimmed.replace(/[$€£,\s]/g, "");
  if (stripped && stripped !== trimmed) out.add(stripped);

  // Phrase prefixes/suffixes for titles and wrapped descriptions.
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    out.add(words.slice(0, 3).join(" "));
    out.add(words.slice(0, Math.min(5, words.length)).join(" "));
    out.add(words.slice(0, Math.min(8, words.length)).join(" "));
    if (words.length >= 4) out.add(words.slice(-4).join(" "));
  }
  // Prefer longer candidates first when matching.
  return [...out]
    .filter((item) => item.length >= 2)
    .sort((left, right) => right.length - left.length);
};
