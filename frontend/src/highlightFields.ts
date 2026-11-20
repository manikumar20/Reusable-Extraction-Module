const MARK = "field-mark";
const ACTIVE = "field-mark-active";

const compactOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Values short enough to light up unrelated text are skipped. */
const usableNeedles = (values: string[]) => {
  const seen = new Set<string>();
  const needles: string[] = [];
  for (const value of values) {
    const compact = compactOf(value);
    if (compact.length < 2 || seen.has(compact)) continue;
    if (/^\d+$/.test(compact) && compact.length < 4) continue;
    seen.add(compact);
    needles.push(compact);
  }
  needles.sort((left, right) => right.length - left.length);
  return needles;
};

const collectHits = (compact: string, needles: string[], active: string) => {
  const hits: { start: number; end: number; active: boolean }[] = [];
  for (const needle of needles) {
    let from = 0;
    while (from < compact.length) {
      const at = compact.indexOf(needle, from);
      if (at < 0) break;
      hits.push({ start: at, end: at + needle.length, active: needle === active });
      from = at + needle.length;
    }
  }
  return hits;
};

export const highlightPdfText = (
  root: ParentNode,
  values: string[],
  activeValue: string,
) => {
  const spans = [...root.querySelectorAll<HTMLElement>(".react-pdf__Page__textContent span")];
  for (const span of spans) span.classList.remove(MARK, ACTIVE);
  const needles = usableNeedles(values);
  const active = compactOf(activeValue);
  if (!spans.length || !needles.length) return { hits: 0, hasText: false };

  const owners: HTMLElement[] = [];
  let compact = "";
  for (const span of spans) {
    const text = span.textContent ?? "";
    for (const char of text) {
      if (!/[a-z0-9]/i.test(char)) continue;
      compact += char.toLowerCase();
      owners.push(span);
    }
  }
  if (!compact) return { hits: 0, hasText: false };

  const marked = new Set<HTMLElement>();
  let hits = 0;
  for (const hit of collectHits(compact, needles, active)) {
    hits += 1;
    for (let index = hit.start; index < hit.end; index += 1) {
      const span = owners[index];
      if (!span || marked.has(span)) {
        if (span && hit.active) span.classList.add(ACTIVE);
        continue;
      }
      marked.add(span);
      span.classList.add(MARK);
      if (hit.active) span.classList.add(ACTIVE);
    }
  }
  return { hits, hasText: true };
};

const unwrapMarks = (root: ParentNode) => {
  for (const mark of [...root.querySelectorAll(`mark.${MARK}`)]) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
};

export const highlightHtmlText = (
  root: HTMLElement,
  values: string[],
  activeValue: string,
) => {
  unwrapMarks(root);
  const needles = usableNeedles(values);
  const active = compactOf(activeValue);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current.textContent) nodes.push(current as Text);
    current = walker.nextNode();
  }
  if (!nodes.length || !needles.length) return { hits: 0, hasText: false };

  const points: { node: Text; offset: number }[] = [];
  let compact = "";
  for (const node of nodes) {
    const text = node.data;
    for (let offset = 0; offset < text.length; offset += 1) {
      if (!/[a-z0-9]/i.test(text[offset] ?? "")) continue;
      compact += text[offset]!.toLowerCase();
      points.push({ node, offset });
    }
  }
  if (!compact) return { hits: 0, hasText: false };

  const ranges = new Map<Text, { start: number; end: number; active: boolean }[]>();
  let hits = 0;
  for (const hit of collectHits(compact, needles, active)) {
    hits += 1;
    let index = hit.start;
    while (index < hit.end) {
      const point = points[index];
      if (!point) break;
      let endIndex = index;
      while (endIndex + 1 < hit.end && points[endIndex + 1]?.node === point.node) endIndex += 1;
      const list = ranges.get(point.node) ?? [];
      list.push({
        start: point.offset,
        end: points[endIndex]!.offset + 1,
        active: hit.active,
      });
      ranges.set(point.node, list);
      index = endIndex + 1;
    }
  }

  for (const [node, list] of ranges) {
    const merged: { start: number; end: number; active: boolean }[] = [];
    for (const range of list.sort((left, right) => left.start - right.start)) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end) {
        last.end = Math.max(last.end, range.end);
        last.active = last.active || range.active;
      } else {
        merged.push({ ...range });
      }
    }
    for (const range of merged.sort((left, right) => right.start - left.start)) {
      if (!node.parentNode || range.start >= range.end || range.end > node.data.length) continue;
      const slice = document.createRange();
      slice.setStart(node, range.start);
      slice.setEnd(node, range.end);
      const mark = document.createElement("mark");
      mark.className = range.active ? `${MARK} ${ACTIVE}` : MARK;
      try {
        slice.surroundContents(mark);
      } catch {
        /* Range crossed an element boundary; skip this slice. */
      }
    }
  }
  return { hits, hasText: true };
};
